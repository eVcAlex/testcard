import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dirs = [join(process.cwd(), "src/demo"), join(process.cwd(), "src/home")];

describe("render paths are pure", () => {
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))) {
      it(`${dir.split("/").at(-1)}/${f} has no Date.now, new Date or Math.random`, () => {
        const src = readFileSync(join(dir, f), "utf8");
        expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random/);
      });
    }
  }
});
