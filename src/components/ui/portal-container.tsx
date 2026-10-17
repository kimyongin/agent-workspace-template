import { createContext } from "react";

/** Owned DOM boundary for official popups nested inside a dialog. */
export const PopupContainerContext = createContext<HTMLElement | null>(null);
