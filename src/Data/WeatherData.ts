export type WeatherDay = {
    date: string;
    dayName: string;
    weatherCode: number;
    weatherLabel: string;
    icon: string;
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
        icon: string;
        windSpeed: number;
    };
    today: WeatherDay;
    forecast: WeatherDay[];
};

const LATITUDE = 59.9512;
const LONGITUDE = 10.8678;

function weatherInfo(code: number): { label: string; icon: string } {
    if (code === 0) return { label: "Klart", icon: "☀" };
    if (code === 1) return { label: "For det meste klart", icon: "🌤" };
    if (code === 2) return { label: "Delvis skyet", icon: "⛅" };
    if (code === 3) return { label: "Overskyet", icon: "☁" };

    if ([45, 48].includes(code))
        return { label: "Tåke", icon: "≋" };

    if ([51, 53, 55, 56, 57].includes(code))
        return { label: "Yr", icon: "🌧" };

    if ([61, 63, 65, 66, 67].includes(code))
        return { label: "Regn", icon: "🌧" };

    if ([71, 73, 75, 77].includes(code))
        return { label: "Snø", icon: "❄" };

    if ([80, 81, 82].includes(code))
        return { label: "Regnbyger", icon: "🌦" };

    if ([85, 86].includes(code))
        return { label: "Snøbyger", icon: "❄" };

    if ([95, 96, 99].includes(code))
        return { label: "Torden", icon: "⚡" };

    return { label: "Ukjent", icon: "?" };
}

function norwegianDay(dateString: string): string {
    const names = ["SØN", "MAN", "TIR", "ONS", "TOR", "FRE", "LØR"];
    const date = new Date(dateString + "T12:00:00");
    return names[date.getDay()];
}

export async function getWeather(): Promise<WeatherData> {
    const params = new URLSearchParams({
        latitude: LATITUDE.toString(),
        longitude: LONGITUDE.toString(),
        timezone: "Europe/Oslo",
        forecast_days: "7",
        wind_speed_unit: "ms",
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
            "precipitation_probability_max",
        ].join(","),
    });

    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    );

    if (!response.ok) {
        throw new Error(`Open-Meteo error: ${response.status}`);
    }

    const data = await response.json();

    const days: WeatherDay[] = data.daily.time.map(
        (date: string, index: number) => {
            const info = weatherInfo(data.daily.weather_code[index]);

            return {
                date,
                dayName: norwegianDay(date),
                weatherCode: data.daily.weather_code[index],
                weatherLabel: info.label,
                icon: info.icon,
                maxTemp: Math.round(data.daily.temperature_2m_max[index]),
                minTemp: Math.round(data.daily.temperature_2m_min[index]),
                rainChance:
                    data.daily.precipitation_probability_max[index] ?? 0,
            };
        }
    );

    const currentInfo = weatherInfo(data.current.weather_code);

    return {
        location: "Kalbakken",
        current: {
            temperature: Math.round(data.current.temperature_2m),
            apparentTemperature: Math.round(
                data.current.apparent_temperature
            ),
            weatherCode: data.current.weather_code,
            weatherLabel: currentInfo.label,
            icon: currentInfo.icon,
            windSpeed: Math.round(data.current.wind_speed_10m),
        },
        today: days[0],
        forecast: days.slice(1, 6),
    };
}
