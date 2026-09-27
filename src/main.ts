import "./style.css";
import { createApp } from "./app/stages";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app missing");
createApp(root);
