import { Band } from "../home/Band.tsx";
import { Feeds } from "../home/Feeds.tsx";
import { Films } from "../home/Films.tsx";
import { Hero } from "../home/Hero.tsx";
import { Names } from "../home/Names.tsx";
import { Sofa } from "../home/Sofa.tsx";
import { Sources } from "../home/Sources.tsx";

export function Home() {
  return (
    <>
      <Hero />
      <Names />
      <Feeds />
      <Films />
      <Sofa />
      <Sources />
      <Band />
    </>
  );
}
