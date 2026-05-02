// index.tsx — entry point
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import "./styles/tokens.css";
import "./styles/app-layout.css";
import "./styles/utilities.css";
import "./styles/bottom-tab.css";
import "./styles/toast.css";
import "./styles/tooltip.css";
import "./styles/cohort.css";
import { App } from "./App";
import { registerServiceWorker } from "./pwa";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

render(
  () => (
    <Router>
      {/* 全パスを App に流し、App 内部で useLocation を使って切替える */}
      <Route path="*" component={App} />
    </Router>
  ),
  root,
);

registerServiceWorker();
