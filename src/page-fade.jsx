import { StrictMode, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { motion } from "framer-motion";

function PageFade() {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const r = ref.current;
    if (!r) {
      return;
    }

    const nav = document.querySelector("body > nav.site-nav");
    const mainEl = document.querySelector("main");
    const hero = document.getElementById("hero");

    function appendIf(el) {
      if (el && !r.contains(el)) {
        r.appendChild(el);
      }
    }

    if (mainEl && hero && mainEl.contains(hero)) {
      appendIf(mainEl);
      return;
    }

    if (nav && mainEl && !mainEl.contains(nav)) {
      appendIf(nav);
    }
    appendIf(hero);
    appendIf(mainEl);
  }, []);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      style={{ minHeight: "100%" }}
    />
  );
}

const mount = document.getElementById("grafford-react-fade-root");
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <PageFade />
    </StrictMode>,
  );
}
