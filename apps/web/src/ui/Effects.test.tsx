import { fireEvent, render } from "@testing-library/react";
import { Effects } from "./Effects.tsx";

const push = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push } }),
  useRouterState: () => "/",
}));
vi.mock("./motion.ts", () => ({
  animated: () => true,
  engine: () => Promise.reject(new Error("no motion layer")),
  whenEngine: () => {},
}));

beforeEach(() => {
  push.mockClear();
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: false }) as MediaQueryList);
  document.body.innerHTML = '<main id="main"></main><a id="route" href="/faq">FAQ</a><a id="file" href="/fonts/OFL-PlusJakartaSans.txt">Licence</a><a id="exe" href="/app/Testcard-Setup.exe">Get</a>';
});

describe("Effects page-change interception", () => {
  it("leaves links to files to the browser", () => {
    render(<Effects />);
    for (const id of ["file", "exe"]) {
      expect(fireEvent.click(document.getElementById(id)!)).toBe(true); // true = not prevented
    }
    expect(push).not.toHaveBeenCalled();
  });

  it("takes over route links, and still navigates when the motion layer cannot load", async () => {
    render(<Effects />);
    expect(fireEvent.click(document.getElementById("route")!)).toBe(false);
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/faq"));
  });
});
