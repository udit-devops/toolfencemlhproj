"""Mock tool registry and the permit-checked executor.

All tools are synthetic: nothing here sends email, touches real records or
contacts the network. Protected implementations can only be invoked through
``ToolExecutor.execute`` with an HMAC-signed, single-use ``ExecutionPermit``
issued by the gateway after an ``allow`` policy decision.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict, Field

from .schemas import ExecutionResult, PolicyDecision

Sensitivity = Literal["read_only", "sensitive", "destructive"]

EMAIL_OR_URL = r"^([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}|https://[A-Za-z0-9.\-]+\.[A-Za-z]{2,}(/[^\s]*)?)$"


# --------------------------------------------------------------------------- argument schemas


class GetCustomerCountArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment: Literal["all", "enterprise", "smb"] = "all"


class SendReportArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    destination: str = Field(max_length=254, pattern=EMAIL_OR_URL)
    report_type: Literal["weekly_summary", "customer_count"]


class ExportCustomerDataArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: Literal["csv", "json"]
    destination: str = Field(max_length=254, pattern=EMAIL_OR_URL)
    include_pii: bool = False


class DeleteCustomerRecordsArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: Literal["inactive", "all"]
    confirm: bool


# --------------------------------------------------------------------------- synthetic implementations
# These are module-private on purpose; only the registry references them.

_SYNTHETIC_COUNTS = {"all": 42, "enterprise": 9, "smb": 33}


def _get_customer_count(args: GetCustomerCountArgs) -> Dict[str, Any]:
    return {"segment": args.segment, "customer_count": _SYNTHETIC_COUNTS[args.segment], "data": "synthetic"}


def _send_report(args: SendReportArgs) -> Dict[str, Any]:
    return {"simulated": True, "note": "No message was sent; this is a mock tool.",
            "destination": args.destination, "report_type": args.report_type}


def _export_customer_data(args: ExportCustomerDataArgs) -> Dict[str, Any]:
    return {"simulated": True, "note": "No data left the system; this is a mock tool.",
            "rows": 42, "format": args.format, "destination": args.destination}


def _delete_customer_records(args: DeleteCustomerRecordsArgs) -> Dict[str, Any]:
    return {"simulated": True, "note": "Nothing was deleted; this is a mock tool.", "scope": args.scope}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    sensitivity: Sensitivity
    args_model: Type[BaseModel]
    implementation: Callable[[Any], Any]
    destination_field: Optional[str] = None

    def public_info(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "sensitivity": self.sensitivity,
            "destination_field": self.destination_field,
            "arguments_schema": self.args_model.model_json_schema(),
        }


def build_registry() -> Dict[str, ToolSpec]:
    specs = [
        ToolSpec("get_customer_count", "Return the number of customers in a segment (synthetic).",
                 "read_only", GetCustomerCountArgs, _get_customer_count),
        ToolSpec("send_report", "Send a summary report to a destination (simulated).",
                 "sensitive", SendReportArgs, _send_report, destination_field="destination"),
        ToolSpec("export_customer_data", "Export the customer table to a destination (simulated).",
                 "sensitive", ExportCustomerDataArgs, _export_customer_data, destination_field="destination"),
        ToolSpec("delete_customer_records", "Delete customer records (simulated).",
                 "destructive", DeleteCustomerRecordsArgs, _delete_customer_records),
    ]
    return {s.name: s for s in specs}


# --------------------------------------------------------------------------- permits


def _canonical(args: Dict[str, Any]) -> str:
    return json.dumps(args, sort_keys=True, separators=(",", ":"), default=str)


@dataclass(frozen=True)
class ExecutionPermit:
    event_id: str
    tool_name: str
    arguments: Dict[str, Any]
    signature: str


class PermitIssuer:
    """Mints permits. Held only by the gateway; refuses anything but an allow decision."""

    def __init__(self, key: bytes):
        self._key = key

    def issue(self, event_id: str, tool_name: str, validated_args: BaseModel,
              decision: PolicyDecision) -> ExecutionPermit:
        if decision.decision != "allow":
            raise PermissionError("permits are only issued for allow decisions")
        args = validated_args.model_dump()
        sig = hmac.new(self._key, f"{event_id}|{tool_name}|{_canonical(args)}".encode(), hashlib.sha256).hexdigest()
        return ExecutionPermit(event_id, tool_name, args, sig)


class ToolExecutor:
    """The only code path that calls a tool implementation."""

    def __init__(self, registry: Dict[str, ToolSpec], key: bytes):
        self._registry = registry
        self._key = key
        self._used: set = set()
        self._lock = threading.Lock()

    def execute(self, permit: ExecutionPermit) -> ExecutionResult:
        expected = hmac.new(self._key, f"{permit.event_id}|{permit.tool_name}|{_canonical(permit.arguments)}".encode(),
                            hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, permit.signature):
            raise PermissionError("invalid execution permit")
        with self._lock:
            if permit.event_id in self._used:
                raise PermissionError("execution permit already used")
            self._used.add(permit.event_id)
        spec = self._registry.get(permit.tool_name)
        if spec is None:
            raise PermissionError("permit names an unknown tool")
        args = spec.args_model.model_validate(permit.arguments)  # re-validate at the boundary
        try:
            return ExecutionResult(status="executed", output=spec.implementation(args))
        except Exception as exc:  # mock tools should not fail, but never leak a traceback
            return ExecutionResult(status="failed", error=f"{type(exc).__name__}: {exc}")
