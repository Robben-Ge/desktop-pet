const builder = require("electron-builder");

builder
  .build({
    win: ["nsis"],
    publish: "never"
  })
  .then(() => {
    console.log("BUILD_OK");
    process.exit(0);
  })
  .catch((error) => {
    console.error("BUILD_FAIL", error);
    process.exit(1);
  });
