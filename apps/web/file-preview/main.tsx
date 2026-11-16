import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";
import "../app/globals.css";

import { createRoot } from "react-dom/client";

import { FilePreviewApp } from "./file-preview-app";

const root = document.getElementById("root");
if (root === null) throw new Error("Preview root is missing");
createRoot(root).render(<FilePreviewApp />);
