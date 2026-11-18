class ServiceError(Exception):
    """Business-rule failure that maps directly to an HTTP status and message."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail
