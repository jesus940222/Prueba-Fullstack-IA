class AiError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ProviderError(Exception):
    def __init__(self, code: str, sample=None):
        super().__init__(code)
        self.code = code
        self.sample = sample
