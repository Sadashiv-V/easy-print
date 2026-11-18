from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class AgentItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    document_name: str
    copies: int
    color_mode: str
    duplex: bool
    page_ranges: str
    selected_pages: int
    status: str


class AgentJob(BaseModel):
    id: int
    items: List[AgentItem]


class ItemResult(BaseModel):
    status: Literal["done", "failed"]
    reason: Optional[str] = Field(None, max_length=200)


class PrinterStatusIn(BaseModel):
    status: Literal["online", "offline", "no_paper", "error"]
    message: Optional[str] = Field(None, max_length=100)
