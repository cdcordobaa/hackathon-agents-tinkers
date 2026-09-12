// This import must stay first — see src/livekit-globals.ts for why.
import "./src/livekit-globals";

import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
