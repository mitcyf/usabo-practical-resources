(() => {
  "use strict";

  const tools = new Set(["dataset-explorer", "regression-trainer", "regression-evaluator"]);
  const buttons = Array.from(document.querySelectorAll("[data-ml-tool]"));
  if (!buttons.length) return;

  function activeId() {
    const id = window.location.hash.replace(/^#/, "");
    return tools.has(id) ? id : "dataset-explorer";
  }

  function render() {
    const id = activeId();
    buttons.forEach((button) => {
      const active = button.dataset.mlTool === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      history.replaceState(null, "", "#" + button.dataset.mlTool);
      render();
    });
  });

  window.addEventListener("hashchange", render);
  render();
})();
