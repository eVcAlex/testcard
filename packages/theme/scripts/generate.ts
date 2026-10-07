import { writeFileSync } from "node:fs";
import { cssFor } from "../src/css.ts";

writeFileSync(new URL("../colors.css", import.meta.url), cssFor());
