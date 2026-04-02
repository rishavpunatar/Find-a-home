from pipeline.jobs.generate_property_metrics import (
    filter_otm_listings,
    parse_price_to_number,
    price_score,
    slugify_location_name,
)


def test_slugify_location_name_handles_station_punctuation() -> None:
    assert slugify_location_name("St. John's Wood") == 'st-johns-wood'
    assert slugify_location_name('Harrow & Wealdstone') == 'harrow-and-wealdstone'
    assert slugify_location_name('Watford (Met)') == 'watford'


def test_parse_price_to_number_supports_compact_and_full_formats() -> None:
    assert parse_price_to_number('£1,250,000') == 1_250_000.0
    assert parse_price_to_number('£1.5m') == 1_500_000.0
    assert parse_price_to_number('£850k') == 850_000.0


def test_filter_otm_listings_keeps_only_3_plus_bed_2_plus_bath_semis() -> None:
    listings = [
        {
            'id': 'keep',
            'humanised-property-type': 'Semi-detached house',
            'bedrooms': 4,
            'bathrooms': 2,
            'price': '£950,000',
            'location': {'lat': 51.59, 'lon': -0.38},
        },
        {
            'id': 'drop-type',
            'humanised-property-type': 'Detached house',
            'bedrooms': 4,
            'bathrooms': 2,
            'price': '£1,100,000',
            'location': {'lat': 51.59, 'lon': -0.38},
        },
        {
            'id': 'drop-bath',
            'humanised-property-type': 'Semi-detached house',
            'bedrooms': 4,
            'bathrooms': 1,
            'price': '£875,000',
            'location': {'lat': 51.59, 'lon': -0.38},
        },
    ]

    filtered = filter_otm_listings(listings, station_lat=51.5931, station_lon=-0.3818)

    assert len(filtered) == 1
    assert filtered[0]['id'] == 'keep'


def test_price_score_falls_as_median_price_rises() -> None:
    assert price_score(300_000) > price_score(800_000) > price_score(1_200_000)
