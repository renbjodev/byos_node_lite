import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

export type WeatherDay = {
    date: string;
    dayName: string;
    weatherCode: number;
    weatherLabel: string;
    iconSvg: string;
    maxTemp: number;
    minTemp: number;
    precipitationMm: number;
};

export type WeatherData = {
    location: string;

    current: {
        temperature: number;
        apparentTemperature: number;
        weatherCode: number;
        weatherLabel: string;
        iconSvg: string;
        windSpeed: number;
    };

    today: WeatherDay;
    forecast: WeatherDay[];
};

const LATITUDE = 59.9512;
const LONGITUDE = 10.8678;

const require = createRequire(import.meta.url);

const iconCache = new Map<string, string>();


/**
 * Convert Open-Meteo WMO weather codes to
 * labels + Meteocons icon names.
 */
function weatherInfo(
    code: number
): { label: string; icon: string } {

    // Clear sky
    if (code === 0) {
        return {
            label: "Klart",
            icon: "clear-day",
        };
    }

    // Mainly clear
    if (code === 1) {
        return {
            label: "For det meste klart",
            icon: "partly-cloudy-day",
        };
    }

    // Partly cloudy
    if (code === 2) {
        return {
            label: "Delvis skyet",
            icon: "overcast-day",
        };
    }

    // Overcast
    if (code === 3) {
        return {
            label: "Overskyet",
            icon: "overcast",
        };
    }

    // Fog
    if ([45, 48].includes(code)) {
        return {
            label: "Tåke",
            icon: "fog-day",
        };
    }

    // Drizzle
    if ([51, 53, 55].includes(code)) {
        return {
            label: "Yr",
            icon: "drizzle",
        };
    }

    // Freezing drizzle
    if ([56, 57].includes(code)) {
        return {
            label: "Underkjølt yr",
            icon: "extreme-drizzle",
        };
    }

    // Light rain
    if (code === 61) {
        return {
            label: "Lett regn",
            icon: "drizzle",
        };
    }

    // Moderate rain
    if (code === 63) {
        return {
            label: "Regn",
            icon: "rain",
        };
    }

    // Heavy / freezing rain
    if ([65, 66, 67].includes(code)) {
        return {
            label: "Kraftig regn",
            icon: "extreme-rain",
        };
    }

    // Snow
    if ([71, 73].includes(code)) {
        return {
            label: "Snø",
            icon: "snow",
        };
    }

    // Heavy snow
    if ([75, 77].includes(code)) {
        return {
            label: "Kraftig snø",
            icon: "extreme-snow",
        };
    }

    // Light rain showers
    if (code === 80) {
        return {
            label: "Lette regnbyger",
            icon: "partly-cloudy-day-rain",
        };
    }

    // Moderate rain showers
    if (code === 81) {
        return {
            label: "Regnbyger",
            icon: "overcast-rain",
        };
    }

    // Heavy rain showers
    if (code === 82) {
        return {
            label: "Kraftige regnbyger",
            icon: "extreme-day-rain",
        };
    }

    // Snow showers
    if (code === 85) {
        return {
            label: "Snøbyger",
            icon: "partly-cloudy-day-snow",
        };
    }

    if (code === 86) {
        return {
            label: "Kraftige snøbyger",
            icon: "extreme-day-snow",
        };
    }

    // Thunder
    if (code === 95) {
        return {
            label: "Torden",
            icon: "thunderstorms-day",
        };
    }

    // Thunder + precipitation
    if ([96, 99].includes(code)) {
        return {
            label: "Torden og regn",
            icon: "thunderstorms-day-rain",
        };
    }

    return {
        label: "Ukjent",
        icon: "overcast",
    };
}


/**
 * Norwegian weekday abbreviation.
 */
function norwegianDay(dateString: string): string {
    const names = [
        "SØN",
        "MAN",
        "TIR",
        "ONS",
        "TOR",
        "FRE",
        "LØR",
    ];

    const date = new Date(
        dateString + "T12:00:00"
    );

    return names[date.getDay()];
}


/**
 * Load a static monochrome Meteocon directly
 * from the installed npm package.
 *
 * No CDN.
 * No browser image loading.
 * No external request.
 */
async function getMeteoconSvg(
    iconName: string
): Promise<string> {

    const cached = iconCache.get(iconName);

    if (cached) {
        return cached;
    }

    try {
        const iconPath = require.resolve(
            `@meteocons/svg-static/monochrome/${iconName}.svg`
        );

        let svg = await readFile(
            iconPath,
            "utf8"
        );

        /*
         * Monochrome Meteocons use currentColor.
         * Force solid black for Kindle/e-ink.
         */
        svg = svg.replaceAll(
            "currentColor",
            "#000000"
        );

        /*
         * Remove XML declaration if present.
         */
        svg = svg.replace(
            /<\?xml[^>]*\?>/g,
            ""
        );

        iconCache.set(
            iconName,
            svg
        );

        return svg;

    } catch (error) {

        console.error(
            `Failed to load Meteocon "${iconName}"`,
            error
        );

        /*
         * Always fall back to a known-safe icon.
         */
        if (iconName !== "overcast") {
            return getMeteoconSvg(
                "overcast"
            );
        }

        return "";
    }
}


/**
 * Get Open-Meteo weather data for Kalbakken.
 */
export async function getWeather(): Promise<WeatherData> {

    const params = new URLSearchParams({

        latitude:
            LATITUDE.toString(),

        longitude:
            LONGITUDE.toString(),

        timezone:
            "Europe/Oslo",

        forecast_days:
            "7",

        wind_speed_unit:
            "ms",

        current: [
            "temperature_2m",
            "apparent_temperature",
            "weather_code",
            "wind_speed_10m",
        ].join(","),

        daily: [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
        ].join(","),

    });


    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    );


    if (!response.ok) {
        throw new Error(
            `Open-Meteo error: ${response.status}`
        );
    }


    const data = await response.json();


    /*
     * Build daily forecast data.
     */
    const rawDays = data.daily.time.map(
        (
            date: string,
            index: number
        ) => {

            const weatherCode =
                data.daily.weather_code[index];

            const info =
                weatherInfo(weatherCode);

            return {

                date,

                dayName:
                    norwegianDay(date),

                weatherCode,

                weatherLabel:
                    info.label,

                iconName:
                    info.icon,

                maxTemp:
                    Math.round(
                        data.daily
                            .temperature_2m_max[index]
                    ),

                minTemp:
                    Math.round(
                        data.daily
                            .temperature_2m_min[index]
                    ),

                precipitationMm:
                    Math.round(
                        (
                            data.daily
                                .precipitation_sum[index]
                            ?? 0
                        ) * 10
                    ) / 10,

            };
        }
    );


    /*
     * Load static SVG icons locally.
     */
    const days: WeatherDay[] =
        await Promise.all(

            rawDays.map(
                async (day: any) => ({

                    date:
                        day.date,

                    dayName:
                        day.dayName,

                    weatherCode:
                        day.weatherCode,

                    weatherLabel:
                        day.weatherLabel,

                    iconSvg:
                        await getMeteoconSvg(
                            day.iconName
                        ),

                    maxTemp:
                        day.maxTemp,

                    minTemp:
                        day.minTemp,

                    precipitationMm:
                        day.precipitationMm,

                })
            )
        );


    /*
     * Current weather.
     */
    const currentCode =
        data.current.weather_code;

    const currentInfo =
        weatherInfo(currentCode);


    const currentIconSvg =
        await getMeteoconSvg(
            currentInfo.icon
        );


    return {

        location:
            "Kalbakken",

        current: {

            temperature:
                Math.round(
                    data.current.temperature_2m
                ),

            apparentTemperature:
                Math.round(
                    data.current.apparent_temperature
                ),

            weatherCode:
                currentCode,

            weatherLabel:
                currentInfo.label,

            iconSvg:
                currentIconSvg,

            windSpeed:
                Math.round(
                    data.current.wind_speed_10m
                ),

        },

        today:
            days[0],

        forecast:
            days.slice(1, 6),

    };
}
