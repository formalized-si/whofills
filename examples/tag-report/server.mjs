// What to do with verdicts in tag mode: keep them, then read them.
//   npm run build && node examples/tag-report/server.mjs
//   npm run whofills -- summarize decisions.jsonl
// Only the decision goes in the file, not the form's fields, so this log holds nobody's answers.
import { appendFileSync } from "node:fs";
import express from "express";
import { createGuard } from "../../packages/whofills/dist/server/index.js";

const guard = createGuard({ secret: process.env.WHOFILLS_SECRET ?? "change-me-to-a-long-random-string", mode: "tag" });
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use("/whofills.js", express.static(new URL("../../packages/whofills/dist/whofills.js", import.meta.url).pathname));

app.get("/", (_req, res) =>
  res.type("html").send(`<!doctype html><html lang="en"><title>Apply</title>
<form class="application" method="post" action="/apply">
  <label>Name <input name="name" required></label><br>
  <button type="submit">Submit</button>
</form>
<script src="/whofills.js" defer data-protect="form.application" data-attest="gate"></script>`),
);

app.post("/apply", guard.express(), (req, res) => {
  appendFileSync("decisions.jsonl", `${JSON.stringify({ at: new Date().toISOString(), ...req.whofills })}\n`);
  res.type("html").send("<h1>Received</h1>");
});
app.listen(3000, () => console.log("http://localhost:3000"));
