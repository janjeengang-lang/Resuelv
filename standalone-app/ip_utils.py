import requests

FALLBACK = {"ip": "N/A", "country": "N/A", "city": "N/A", "isp": "N/A"}


def fetch_ip_info():
    """Fetch IP information from several providers with fallback."""
    services = [
        (
            "https://ipapi.co/json/",
            lambda d: {
                "ip": d.get("ip"),
                "country": d.get("country_name"),
                "city": d.get("city"),
                "isp": d.get("org"),
            },
        ),
        (
            "https://ipinfo.io/json",
            lambda d: {
                "ip": d.get("ip"),
                "country": d.get("country"),
                "city": d.get("city"),
                "isp": d.get("org"),
            },
        ),
        (
            "http://ip-api.com/json/",
            lambda d: {
                "ip": d.get("query"),
                "country": d.get("country"),
                "city": d.get("city"),
                "isp": d.get("isp"),
            },
        ),
        (
            "https://api.ipify.org?format=json",
            lambda d: {"ip": d.get("ip")},
        ),
    ]

    for url, parser in services:
        try:
            r = requests.get(url, timeout=5)
            r.raise_for_status()
            data = parser(r.json())
            return {**FALLBACK, **{k: v for k, v in data.items() if v}}
        except Exception:
            continue
    return FALLBACK


if __name__ == "__main__":
    print(fetch_ip_info())
