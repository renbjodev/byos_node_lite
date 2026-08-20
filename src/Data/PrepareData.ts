import {TIMEZONE} from "Config.js";
import {getWeather, WeatherData} from "./WeatherData.js";

export type TemplateDataType = {
    time: string;
    weather: WeatherData;
};

export async function prepareData(): Promise<TemplateDataType> {
    const time = new Date().toLocaleTimeString("nb-NO", {
        timeZone: TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
    });

    const weather = await getWeather();

    return {
        time,
        weather,
    };
}
