(() => {
  "use strict";

  const CYCLE_MS = 10 * 60 * 1000;
  const SATURATION = 62;
  const LIGHTNESS = 78;

  function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function updateStripeColor() {
    const elapsed = positiveModulo(Date.now(), CYCLE_MS);
    const hue = (elapsed / CYCLE_MS) * 360;
    document.documentElement.style.setProperty(
      "--proctor-stripe",
      "hsl(" + hue.toFixed(2) + ", " + SATURATION + "%, " + LIGHTNESS + "%)"
    );
  }

  function tick() {
    updateStripeColor();
    window.setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  tick();
})();
