// Motion's animation features (including layout, for the sliding tab pill), loaded as their own
// chunk after startup instead of with the app (LazyMotion in main.tsx).
// `animate` (the sheet swipe's release spring) lives here too: importing it anywhere else pulls
// Motion's animation engine into the main bundle (+18 kB gzip, measured for v1.2).
import { animate, domMax } from "motion/react";

export { animate };
export default domMax;
