from django.db import models
from django.contrib.auth import get_user_model
from django.db.models import Q

User = get_user_model()

class ThreadManager(models.Manager):
    def get_or_create_thread(self, user1, user2):
    #"""Fetch an existing thread or create a new one."""
        thread, created = self.get_queryset().get_or_create(
        first_person=min(user1, user2, key=lambda x: x.id),
        second_person=max(user1, user2, key=lambda x: x.id)
    )
        return thread, created  


    def by_user(self, user):
        """Fetch all threads related to the user."""
        lookup = Q(first_person=user) | Q(second_person=user)
        return self.get_queryset().filter(lookup).distinct()

class Threads(models.Model):
    first_person = models.ForeignKey(User, on_delete=models.CASCADE, related_name="threads_as_first")
    second_person = models.ForeignKey(User, on_delete=models.CASCADE, related_name="threads_as_second")
    updated = models.DateTimeField(auto_now=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    objects = ThreadManager()

    class Meta:
        unique_together = ["first_person", "second_person"]

    def __str__(self):
        return f"Chat between {self.first_person.username} and {self.second_person.username}"

class ChatMessage(models.Model):
    thread = models.ForeignKey(Threads, on_delete=models.CASCADE, related_name="messages")
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username}: {self.message}"
