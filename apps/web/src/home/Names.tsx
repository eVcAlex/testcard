import { CATEGORIES, NAME_EXAMPLES, SOURCES, channelById } from "../demo/data.ts";
import { RawNamesLink } from "./RawNamesLink.tsx";

export function Names() {
  return (
    <section className="section" aria-labelledby="hm-names">
      <div className="wrap hm-two">
        <div className="hm-copy">
          <h2 id="hm-names">Names, tidied.</h2>
          <p>Provider lists arrive with country prefixes, decorative characters and quality tags jammed into the name. Testcard strips the noise, keeps the quality as a small tag and files each channel in a group.</p>
          <p><RawNamesLink>See the same names in the guide, as sent</RawNamesLink></p>
        </div>
        <div>
          <div className="hm-cols" aria-hidden="true"><span>As your source sends it</span><span>In Testcard</span></div>
          <ul className="hm-names">
            {NAME_EXAMPLES.map((id) => {
              const c = channelById(id);
              const cat = CATEGORIES.find((x) => x.id === c.category)!.label;
              const src = SOURCES.find((x) => x.id === c.source)!.name;
              return (
                <li key={id}>
                  <span className="hm-raw" translate="no"><span className="sr-only">As sent: </span>{c.raw}</span>
                  <span className="hm-tidy"><span className="sr-only">In Testcard: </span><b>{c.name}</b> <small>{c.quality}</small><span className="hm-where">{cat} · {src}</span></span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
