import { redirect } from "next/navigation";

// The root address goes straight into the app: a signed-in patient lands on Today, and anyone else is sent to /signin
// by the middleware. The marketing landing that used to live here (components/site/*) described the earlier
// camera-based Parkinson's and stroke prototype ("no sensors, just your camera"), which is the opposite of this
// knee rehabilitation app. Its components are kept, unreferenced, until it is rewritten for this product.
export default function Page() {
  redirect("/app");
}
