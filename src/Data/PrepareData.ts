import {
    TIMEZONE
} from "Config.js";

import {
    getWeather,
    getPreviewWeather,
    WeatherData
} from "./WeatherData.js";


export type TemplateDataType = {
    time: string;
    weather: WeatherData;
};


// ============================================================
// LIVE — KINDLE ONLY
// ============================================================

export async function prepareData():
Promise<TemplateDataType> {

    const time =
        new Date()
            .toLocaleTimeString(
                "nb-NO",
                {
                    timeZone:
                        TIMEZONE,

                    hour:
                        "2-digit",

                    minute:
                        "2-digit",
                }
            );


    const weather =
        await getWeather();


    return {
        time,
        weather,
    };
}


// ============================================================
// PREVIEW — BROWSER ONLY
// ============================================================

export async function preparePreviewData():
Promise<TemplateDataType> {

    /*
     * Fixed time is intentional:
     * refreshing /image should give a deterministic
     * design preview.
     */
    const time =
        "12:34";


    const weather =
        await getPreviewWeather();


    return {
        time,
        weather,
    };
}
