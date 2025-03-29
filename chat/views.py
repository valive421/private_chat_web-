import json
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.shortcuts import render, get_object_or_404
from chat.models import Threads, ChatMessage

@login_required
def chat_page(request, username=None):
    """Handles chat page rendering and JSON response for AJAX requests."""

    #  Log request headers for debugging
   # print(" Request Headers:", dict(request.headers))  

    users = User.objects.exclude(username=request.user.username)

    #  Check AJAX request
    if request.headers.get("X-Requested-With") == "XMLHttpRequest":
        if username:
            selected_user = get_object_or_404(User, username=username)
            thread, created = Threads.objects.get_or_create_thread(request.user, selected_user)
            messages = ChatMessage.objects.filter(thread=thread).order_by("timestamp")

            messages_data = [
                {
                    "sender": msg.user.username,
                    "content": msg.message,
                    "timestamp": msg.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                }
                for msg in messages
            ]

            return JsonResponse({
                "users": list(users.values("id", "username")),
                "logged_in_user": request.user.username,
                "selected_user": username,
                "messages": messages_data,
            })

        return JsonResponse({"error": "No username provided"}, status=400)

 

    return render(request, "chat1.html", {
        "users": users,
        "logged_in_user": request.user,
        "selected_user": username,
        "messages": [],
    })
