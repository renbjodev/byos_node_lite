import * as path from "node:path";
import {ROUTE_IMAGE} from "./Routes.js";
import * as process from "node:process";

export const SERVER_PORT = 3000;
export const SERVER_HOST = '0.0.0.0';
export const REFRESH_RATE_SECONDS = 60;
export const TIMEZONE = 'Europe/Warsaw';
export const ALLOW_FIRMWARE_UPDATE = true;
export const BUTTON_2_CLICK_FUNCTION = 'sleep'; // https://help.usetrmnl.com/en/articles/9672080-special-functions
export let BYOS_ENABLED = true;
export let BYOS_PROXY = false;

// ----- Calculated constants below
export const SECRET_KEY = readEnvOrFail('SECRET_KEY');
export const PUBLIC_URL_ORIGIN = readEnvOrFail('PUBLIC_URL_ORIGIN');
export const IS_TEST_ENV = mayReadEnv('TEST') === 'true';
export const SCREEN_URL = PUBLIC_URL_ORIGIN + ROUTE_IMAGE + '?secret_key=' + SECRET_KEY;
export const ASSETS_FOLDER = path.join(import.meta.dirname, '..', 'assets');
export const TEMPLATE_FOLDER = path.join(import.meta.dirname, '/', 'Template');
export const BYOS_DEVICE_MAC = mayReadEnv('BYOS_DEVICE_MAC');
export const BYOS_DEVICE_ACCESS_TOKEN = mayReadEnv('BYOS_DEVICE_ACCESS_TOKEN');

if (IS_TEST_ENV) {
    BYOS_ENABLED = true;
    BYOS_PROXY = true;
}

function mayReadEnv(key: string): string | undefined {
    const value = process.env[key];
    if (value === undefined || value.length < 2) {
        return undefined;
    }
    return value;
}

function readEnvOrFail(key: string): string {
    const value = process.env[key];
    if (value === undefined) {
        throw new Error(`Environment variable "${key}" is not set`);
    }
    return value;
}

