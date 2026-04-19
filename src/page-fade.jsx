import { createRoot } from "react-dom/client";
import { motion } from "framer-motion";

/**
 * 페이지 전환 시 1초 페이드 — 전체 화면 오버레이만 애니메이션합니다.
 * (nav/main을 옮기지 않음 → Live Server 등에서 DOM 재구성으로 인한 무한 새로고침 방지)
 */
function PageFadeOverlay() {
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1, ease: "easeInOut" }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "var(--grafford-beige, #e8e1d5)",
        pointerEvents: "none",
      }}
    />
  );
}

const mount = document.getElementById("grafford-react-fade-root");
if (mount) {
  createRoot(mount).render(<PageFadeOverlay />);
}
