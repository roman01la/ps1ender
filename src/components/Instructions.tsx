import React from "react";

export function Instructions() {
  return (
    <div className="instructions">
      <kbd>Tab</kbd> Edit/Object | <kbd>LMB</kbd> Select | <kbd>⇧A</kbd> Add |{" "}
      <kbd>Scroll</kbd> Orbit | <kbd>⌘Scroll</kbd> Zoom | <kbd>⇧Scroll</kbd> Pan
      | <kbd>G</kbd> Grab | <kbd>R</kbd> Rotate | <kbd>S</kbd> Scale |{" "}
      <kbd>1</kbd>
      <kbd>3</kbd>
      <kbd>7</kbd> Views | <kbd>⌘Z</kbd> Undo
    </div>
  );
}
