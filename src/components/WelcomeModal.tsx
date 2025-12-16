import { useState, useEffect } from "react";

interface WelcomeModalProps {
  onClose: () => void;
}

const STORAGE_KEY = "ps1ender_welcome_shown";

export function WelcomeModal({ onClose }: WelcomeModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, "true");
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content welcome-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="welcome-header">
          <h1>Welcome to PS1ender</h1>
          <p className="welcome-subtitle">
            A retro-style 3D editor with PS1 aesthetics
          </p>
        </div>

        <div className="welcome-sections">
          <div className="welcome-section">
            <h3>🎮 Navigation</h3>
            <ul>
              <li>
                <kbd>Scroll</kbd> Orbit camera around object
              </li>
              <li>
                <kbd>⌘ + Scroll</kbd> Zoom in/out
              </li>
              <li>
                <kbd>⇧ + Scroll</kbd> Pan camera
              </li>
              <li>
                <kbd>1</kbd> <kbd>3</kbd> <kbd>7</kbd> Snap to front/side/top
                views
              </li>
            </ul>
          </div>

          <div className="welcome-section">
            <h3>🔧 Object Mode</h3>
            <ul>
              <li>
                <kbd>LMB</kbd> Select object
              </li>
              <li>
                <kbd>⇧ + A</kbd> Add primitive (cube, plane, etc.)
              </li>
              <li>
                <kbd>G</kbd> Grab/Move selected object
              </li>
              <li>
                <kbd>R</kbd> Rotate selected object
              </li>
              <li>
                <kbd>S</kbd> Scale selected object
              </li>
              <li>
                <kbd>X</kbd> <kbd>Y</kbd> <kbd>Z</kbd> Constrain to axis
              </li>
            </ul>
          </div>

          <div className="welcome-section">
            <h3>✏️ Edit Mode</h3>
            <ul>
              <li>
                <kbd>Tab</kbd> Toggle Edit/Object mode
              </li>
              <li>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> Vertex/Edge/Face
                selection
              </li>
              <li>
                <kbd>E</kbd> Extrude edges/faces
              </li>
              <li>
                <kbd>F</kbd> Fill selection (create face/edge)
              </li>
              <li>
                <kbd>A</kbd> Select all
              </li>
              <li>Same G/R/S transforms work on selection</li>
            </ul>
          </div>

          <div className="welcome-section">
            <h3>🎨 Shading Workspace</h3>
            <ul>
              <li>Click "Shading" tab to open node editor</li>
              <li>
                <kbd>⇧ + A</kbd> Add node (Texture, Color, Mix, Voronoi...)
              </li>
              <li>Drag connections between sockets</li>
            </ul>
          </div>

          <div className="welcome-section">
            <h3>💾 General</h3>
            <ul>
              <li>
                <kbd>⌘ + Z</kbd> Undo
              </li>
              <li>
                <kbd>⌘ + ⇧ + Z</kbd> Redo
              </li>
              <li>
                <kbd>X</kbd> Delete selected
              </li>
              <li>Drag & drop .OBJ files to import</li>
            </ul>
          </div>
        </div>

        <div className="welcome-footer">
          <p className="welcome-note">
            🤖 This project was entirely written by AI (Claude) under human
            supervision. Total cost: ~$60 in tokens.
          </p>
          <div className="welcome-footer-actions">
            <label className="welcome-checkbox">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
              Don't show this again
            </label>
            <button className="welcome-btn" onClick={handleClose}>
              Get Started
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function shouldShowWelcome(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "true";
}
