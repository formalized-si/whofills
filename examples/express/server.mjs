// node examples/express/server.mjs  (after `npm run build`, and `npm i express` if you run it outside this repo)
import express from "express";
import { createGuard } from "../../packages/whofills/dist/server/index.js";

const guard = createGuard({ secret: process.env.WHOFILLS_SECRET ?? "change-me-to-a-long-random-string", mode: "hold" });
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use("/whofills.js", express.static(new URL("../../packages/whofills/dist/whofills.js", import.meta.url).pathname));
app.use("/__wf/hold.js", express.static(new URL("../../packages/whofills/dist/hold.js", import.meta.url).pathname));

app.get("/", (_req, res) =>
  res.type("html").send(`<!doctype html><html lang="en"><title>Apply</title>
<form class="application" method="post" action="/apply">
  <label>Name <input name="name" required></label><br>
  <label>Why this program? <textarea name="why" required></textarea></label><br>
  <button type="submit">Submit</button>
</form>
<script src="/whofills.js" defer data-protect="form.application" data-attest="gate"></script>`),
);

app.post("/apply", guard.express(), (req, res) => {
  console.log("application", req.body, req.whofills);
  res.type("html").send("<h1>Received</h1>");
});
app.listen(3000, () => console.log("http://localhost:3000"));
