/**
 * Location channels. Thin: the rules live in ../services/geocoding.ts.
 */
import { ipcMain } from "electron";
import * as geocoding from "../services/geocoding";

export function registerGeocodingIpc(): void {
	ipcMain.handle("geocoding.suggestLocal", (_event, query: string) => geocoding.suggestLocations(query));
	ipcMain.handle("geocoding.lookupAddress", (_event, query: string) => geocoding.lookupAddress(query));
}
