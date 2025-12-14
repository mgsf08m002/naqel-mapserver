from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import zoneinfo


class UserProfile(models.Model):
    """Extended user profile for system admin."""
    ROLE_CHOICES = [
        ('manager', 'Manager'),
        ('editor', 'Editor'),
    ]
    
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    profile_image = models.ImageField(upload_to='profile_images/', blank=True, null=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, blank=True, null=True)
    password_setup_completed = models.BooleanField(default=False)
    account_creation_date = models.DateField(blank=True, null=True)
    account_creation_time = models.TimeField(blank=True, null=True)
    # Manager permissions
    can_access_dashboard = models.BooleanField(default=False)
    can_access_security = models.BooleanField(default=False)
    can_access_account_information = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s Profile"
    
    @staticmethod
    def get_riyadh_datetime():
        """Get current datetime in Riyadh timezone."""
        riyadh_tz = zoneinfo.ZoneInfo('Asia/Riyadh')
        return timezone.now().astimezone(riyadh_tz)
    
    def set_account_creation_datetime(self):
        """Set account creation date and time in Riyadh timezone."""
        riyadh_now = self.get_riyadh_datetime()
        self.account_creation_date = riyadh_now.date()
        self.account_creation_time = riyadh_now.time()
        self.save()
