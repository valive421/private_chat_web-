from django.urls import path
from . import consumers
websocket_urlpatterns=[
    path("chat/",consumers.chat_Consumer.as_asgi()),
]