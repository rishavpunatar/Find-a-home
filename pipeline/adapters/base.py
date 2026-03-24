from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pipeline.models.entities import StationRecord


class StationTransportAdapter(ABC):
    @abstractmethod
    def fetch_stations(self) -> list[StationRecord]:
        raise NotImplementedError


class TransportMetricsAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class PropertyAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class SchoolAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class PollutionAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class GreenSpaceAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class CrimeAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class PopulationAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class PlanningAdapter(ABC):
    @abstractmethod
    def get_by_station(self, station_code: str) -> dict[str, Any] | None:
        raise NotImplementedError


class WellbeingAdapter(ABC):
    @abstractmethod
    def get_by_local_authority(self, local_authority: str) -> dict[str, Any] | None:
        raise NotImplementedError
