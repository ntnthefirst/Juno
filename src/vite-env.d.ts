/// <reference types="vite/client" />

// Pulls in the `window.bureau` declaration, so every renderer file sees the
// bridge contract without importing it.
import "@shared/api";
