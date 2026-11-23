export function createOrbRoot() {
  let root = document.getElementById("orb-root");

  if (!root) {
    root = document.createElement("div");
    root.id = "orb-root";

    Object.assign(root.style, {
      position: "fixed",
      top: "120px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "260px",
      height: "260px",
      pointerEvents: "none",
      zIndex: "20",
    });

    document.body.appendChild(root);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 520;
  canvas.height = 520;
  canvas.style.width = "260px";
  canvas.style.height = "260px";

  root.appendChild(canvas);

  return canvas;
}
