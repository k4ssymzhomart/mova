// Pins the reference-clip geometry table against the files it describes, so that a wrong number there fails here
// rather than silently cropping a patient's exercise in half.
//
// The point of these tests is that they do not restate the table's numbers. They open each poster and read its real
// pixel size out of the JPEG header, they list public/exercises to find clips the table has never heard of, and they
// re-derive every value the table computes. A test that simply repeated the literals would pass for a table that had
// drifted away from the media.
//
// Runner: node:test via `npm run test:unit`, which is why the sibling imports carry an explicit .ts extension. Do not
// move this to vitest; vitest.config.ts only includes ble, telemetry and scoring.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { EXERCISE_CATALOG } from "./catalog.ts";
import {
  CARD_FRAME,
  CLIP_GEOMETRY,
  type ClipGeometry,
  clipAspect,
  clipFitClass,
  clipFocus,
  clipGeometry,
} from "./clipGeometry.ts";

const PUBLIC_DIR = new URL("../../../public/", import.meta.url);
const CLIP_DIR = new URL("exercises/", PUBLIC_DIR);

const ENTRIES: [string, ClipGeometry][] = Object.entries(CLIP_GEOMETRY);

/** The pixel size a JPEG's own start-of-frame marker declares, read without any image library. */
function jpegSize(path: URL): { w: number; h: number } {
  const bytes = readFileSync(path);
  assert.equal(bytes.readUInt16BE(0), 0xffd8, `${path.pathname}: not a JPEG`);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1; // padding between segments
      continue;
    }
    const marker = bytes[at + 1];
    // SOF0..SOF15 carry the frame size; C4 (Huffman), C8 (JPEG extension) and CC (arithmetic coding) do not.
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return { h: bytes.readUInt16BE(at + 5), w: bytes.readUInt16BE(at + 7) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error(`${path.pathname}: no start-of-frame marker`);
}

/** The aspect a Tailwind frame class asks for. Only the shapes this module is allowed to emit are understood. */
function frameAspect(frameClass: string): number {
  if (frameClass === "aspect-video") return 16 / 9;
  if (frameClass === "aspect-square") return 1;
  const arbitrary = /^aspect-\[(\d+)\/(\d+)\]$/.exec(frameClass);
  assert.ok(arbitrary, `unrecognised frame class ${frameClass}`);
  return Number(arbitrary[1]) / Number(arbitrary[2]);
}

function fileName(video: string): string {
  return video.slice("/exercises/".length, -".mp4".length);
}

test("every clip in the table is a file that exists, with its poster beside it", () => {
  for (const [video, geometry] of ENTRIES) {
    assert.match(video, /^\/exercises\/[a-z0-9-]+\.mp4$/, `${video}: key is not a clip URL under /exercises`);
    assert.ok(existsSync(new URL(`${fileName(video)}.mp4`, CLIP_DIR)), `${video}: no such clip`);
    assert.ok(existsSync(new URL(`${fileName(video)}.jpg`, CLIP_DIR)), `${video}: no poster beside the clip`);
    assert.ok(geometry.file.w > 0 && geometry.file.h > 0, `${video}: file size must be positive`);
  }
});

test("no clip ships in public/exercises without a row in the table", () => {
  const onDisk = readdirSync(fileURLToPath(CLIP_DIR))
    .filter((name) => name.endsWith(".mp4"))
    .map((name) => `/exercises/${name}`)
    .sort();
  assert.deepEqual(onDisk, ENTRIES.map(([video]) => video).sort());
});

test("the declared file size is the poster's real pixel size", () => {
  for (const [video, geometry] of ENTRIES) {
    const poster = jpegSize(new URL(`${fileName(video)}.jpg`, CLIP_DIR));
    assert.deepEqual(
      { w: geometry.file.w, h: geometry.file.h },
      poster,
      `${video}: table says ${geometry.file.w}x${geometry.file.h}, poster is ${poster.w}x${poster.h}`,
    );
  }
});

test("a clip's frame is its content's shape, and a landscape clip never gets a portrait frame", () => {
  for (const [video, geometry] of ENTRIES) {
    const frame = frameAspect(geometry.frameClass);
    // A "mixed" clip has no content box, so the only honest frame is the file's own.
    const wanted = clipAspect(geometry) ?? geometry.file.w / geometry.file.h;
    assert.ok(
      Math.abs(frame - wanted) < 0.001,
      `${video}: frame ${geometry.frameClass} is ${frame.toFixed(4)}, content wants ${wanted.toFixed(4)}`,
    );
    assert.equal(geometry.shape, frame < 1 ? "portrait" : "landscape", `${video}: shape disagrees with its frame`);
    if (geometry.shape === "landscape") {
      assert.ok(frame > 1, `${video}: a landscape clip was given the portrait frame ${geometry.frameClass}`);
    }
  }
});

test("content is recorded only where it was measured, and it fits inside the file", () => {
  for (const [video, geometry] of ENTRIES) {
    if (geometry.bars === "mixed") {
      // Honesty: a clip that changes shape mid-playback has no single content box, so none is claimed for it.
      assert.equal(geometry.content, null, `${video}: a mixed clip must not claim one content box`);
      assert.equal(clipAspect(geometry), null, `${video}: a mixed clip has no single aspect`);
      continue;
    }
    assert.ok(geometry.content, `${video}: content was not measured`);
    assert.ok(
      geometry.content.w <= geometry.file.w && geometry.content.h <= geometry.file.h,
      `${video}: content ${geometry.content.w}x${geometry.content.h} does not fit in the file`,
    );
    if (geometry.bars === "none") {
      assert.deepEqual(geometry.content, geometry.file, `${video}: an unbarred clip's content is its whole file`);
    }
  }
});

test("bars decide the band, the fit and the focus", () => {
  for (const [video, geometry] of ENTRIES) {
    if (geometry.bars === "letterbox") {
      assert.ok(geometry.band, `${video}: a letterboxed clip must record the rows it measured`);
      assert.equal(geometry.fit, "cover", `${video}: a letterboxed clip is cropped onto its band, never contained`);
      assert.equal(
        geometry.band.bottom - geometry.band.top + 1,
        geometry.content?.h,
        `${video}: the band's height is the content's height`,
      );
      assert.ok(geometry.band.top >= 0 && geometry.band.bottom < geometry.file.h, `${video}: band leaves the file`);
    } else {
      assert.equal(geometry.band, null, `${video}: only a clip with constant bars has a band`);
      assert.equal(clipFocus(geometry), undefined, `${video}: with no bars to skip, the default centre is right`);
    }
    if (geometry.bars === "mixed") {
      assert.equal(geometry.fit, "contain", `${video}: a clip that changes shape is never cropped`);
    }
  }
});

test("the derived focus puts the top of a cover crop on the first row of picture", () => {
  const letterboxed = ENTRIES.filter(([, geometry]) => geometry.bars === "letterbox");
  assert.ok(letterboxed.length > 0, "the derivation is untested if no clip is letterboxed");
  for (const [video, geometry] of letterboxed) {
    const focus = clipFocus(geometry);
    assert.ok(focus, `${video}: a letterboxed clip needs a focus`);
    const percent = /^50% ([\d.]+)%$/.exec(focus);
    assert.ok(percent, `${video}: focus ${focus} is not a vertical-only object-position`);
    // Re-derive the crop from the measurement and check where the window actually lands.
    const content = geometry.content!;
    const visibleRows = (geometry.file.w * content.h) / content.w;
    const overflowRows = geometry.file.h - visibleRows;
    const windowTop = (Number(percent[1]) / 100) * overflowRows;
    assert.ok(
      windowTop >= geometry.band!.top && windowTop < geometry.band!.top + 1,
      `${video}: focus ${focus} starts the crop at row ${windowTop.toFixed(2)}, not on row ${geometry.band!.top}`,
    );
    // And the bottom of that window must still be inside the picture.
    assert.ok(
      windowTop + visibleRows <= geometry.band!.bottom + 1.5,
      `${video}: the crop runs ${(windowTop + visibleRows).toFixed(2)} past the picture's last row`,
    );
  }
});

test("every catalog clip has geometry, and its poster is the clip's own sibling", () => {
  const attached = EXERCISE_CATALOG.filter((entry) => entry.video !== null);
  assert.ok(attached.length > 0, "the catalog has no attached clips, so this test proves nothing");
  for (const entry of attached) {
    const geometry = clipGeometry(entry.video);
    assert.ok(geometry, `${entry.slug}: ${entry.video} has no geometry`);
    assert.equal(
      entry.poster,
      `${entry.video!.slice(0, -".mp4".length)}.jpg`,
      `${entry.slug}: the poster is not this clip's own`,
    );
  }
});

test("clipGeometry and clipFitClass are safe for a clip nobody has measured", () => {
  assert.equal(clipGeometry(null), undefined);
  assert.equal(clipGeometry(undefined), undefined);
  assert.equal(clipGeometry("/exercises/not-a-clip.mp4"), undefined);
  // An unmeasured clip is contained, never cropped: cropping needs a measurement this module does not have.
  assert.equal(clipFitClass(undefined), "object-contain");
  assert.equal(clipFitClass(CLIP_GEOMETRY["/exercises/quad-set.mp4"]), "object-cover");
  assert.equal(clipFitClass(CLIP_GEOMETRY["/exercises/overview.mp4"]), "object-contain");
});

test("the shared card band is a frame class the library can actually use", () => {
  const ratio = frameAspect(CARD_FRAME);
  assert.ok(ratio > 0, "the card band must have a positive aspect");
  // Both halves of the library are fitted into this one band, so it must not favour either shape outright.
  const portrait = 9 / 16;
  const landscape = 16 / 9;
  assert.ok(
    ratio >= portrait && ratio <= landscape,
    `${CARD_FRAME} is outside the range of the clips it has to hold`,
  );
});
