import "../home/home.css";
import { Hero } from "../home/Hero.tsx";
import { OnScreen } from "../home/OnScreen.tsx";
import { Stack } from "../home/Stack.tsx";
import { Statement } from "../home/Statement.tsx";

export function Home() {
  return (
    <>
      <Hero />
      <Statement />
      <OnScreen />
      <Stack />
    </>
  );
}
