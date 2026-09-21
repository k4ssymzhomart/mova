import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EXERCISE_CATALOG } from "./catalog.ts";
import { clipFrame, clipName, clipSource, knownClipNames } from "./clipFrames.ts";

const PUBLIC = new URL("../../../public/exercises/", import.meta.url);

/** The width and height a JPEG declares in its first start-of-frame marker. */
function jpegSize(file: URL): { width: number; height: number } {
  const bytes = readFileSync(file);
  let i = 2; // skip SOI
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    // SOF0..SOF15, minus the markers in that range that are not frame headers
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error(`no frame header in ${file.pathname}`);
}

test("every clip the catalogue attaches is in the frame table", () => {
  for (const entry of EXERCISE_CATALOG) {
    if (!entry.video) continue;
    assert.ok(clipSource(entry.video), `${entry.slug}: ${entry.video} has no entry in clipFrames.ts`);
    assert.ok(entry.poster, `${entry.slug}: a clip without a poster`);
    assert.equal(clipName(entry.video), clipName(entry.poster ?? ""), `${entry.slug}: clip and poster differ`);
  }
});

test("the table's sizes are the files' own sizes", () => {
  for (const name of knownClipNames()) {
    const source = clipSource(`/exercises/${name}.mp4`);
    assert.ok(source);
    const measured = jpegSize(new URL(`${name}.jpg`, PUBLIC));
    assert.deepEqual(
      { width: source.width, height: source.height },
      measured,
      `${name}: clipFrames.ts says ${source.width}x${source.height}, the poster is ${measured.width}x${measured.height}`,
    );
  }
});

test("a letterboxed clip is framed on its picture, an ordinary one on the whole file", () => {
  const heel = clipFrame("/exercises/heel-slide.mp4");
  assert.ok(heel.wide, "the heel slide picture lies sideways inside an upright file");
  assert.ok(Math.abs(heel.ratio - 16 / 9) < 0.05, `heel slide ratio ${heel.ratio}`);
  assert.equal(heel.objectPosition, "50% 57.8%");

  const overview = clipFrame("/exercises/overview.mp4");
  assert.ok(overview.wide);
  assert.ok(Math.abs(overview.ratio - 16 / 9) < 0.06, `overview ratio ${overview.ratio}`);

  const upright = clipFrame("/exercises/step-up.mp4");
  assert.equal(upright.wide, false);
  assert.ok(Math.abs(upright.ratio - 9 / 16) < 0.01, `step up ratio ${upright.ratio}`);
  assert.equal(upright.objectPosition, "50% 50%");

  const sideways = clipFrame("/exercises/quad-set.mp4");
  assert.equal(sideways.wide, true);
  assert.ok(Math.abs(sideways.ratio - 16 / 9) < 0.01);
});

test("an unknown clip falls back to a sideways frame rather than throwing", () => {
  const unknown = clipFrame("/exercises/not-a-clip.mp4");
  assert.equal(unknown.wide, true);
  assert.equal(unknown.objectPosition, "50% 50%");
});
