const fs = require("fs");
const pj = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
pj.version = "0.2.0";
if (pj.packages && pj.packages[""]) {
  pj.packages[""].version = "0.2.0";
}
fs.writeFileSync("package-lock.json", JSON.stringify(pj, null, 2) + "\n");
console.log("package-lock.json version updated to", pj.version);
