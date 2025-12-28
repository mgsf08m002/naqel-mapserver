(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const avatarButton = document.getElementById('profileAvatar');
        const fileInput = document.getElementById('profileInput');
        const imageEl = document.getElementById('profileImage');
        const initialsEl = document.getElementById('profileInitials');
        const removeBtn = document.getElementById('removePhotoBtn');
        const stateEl = document.getElementById('photoState');
        const editBtn = document.getElementById('editBtn');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const editableFields = document.querySelectorAll('.editable-field');
        const notifyNode = document.getElementById('accountNotify');
        
        // Cropper elements
        const cropModal = document.getElementById('cropModal');
        const cropImage = document.getElementById('cropImage');
        const closeCropModal = document.getElementById('closeCropModal');
        const cancelCrop = document.getElementById('cancelCrop');
        const saveCrop = document.getElementById('saveCrop');
        
        let cropper = null;
        let selectedFile = null;

        if (!avatarButton || !fileInput || !imageEl || !initialsEl) return;

        // Helper function to show notification with retry logic
        function showNotification(message, type = 'info') {
            function tryShowNotification(retries = 10) {
                if (window.notify && window.notify.show) {
                    if (type === 'success') {
                        window.notify.success(message);
                    } else if (type === 'error') {
                        window.notify.error(message);
                    } else if (type === 'warning') {
                        window.notify.warning(message);
                    } else {
                        window.notify.info(message);
                    }
                } else if (retries > 0) {
                    setTimeout(() => tryShowNotification(retries - 1), 50);
                }
            }
            tryShowNotification();
        }

        const syncHeaderAvatars = (imageUrl) => {
            const headerImage = document.getElementById('headerAvatarImage');
            const headerInitials = document.getElementById('headerAvatarInitials');
            const dropdownImage = document.getElementById('dropdownAvatarImage');
            const dropdownInitials = document.getElementById('dropdownAvatarInitials');

            if (imageUrl) {
                if (headerImage) {
                    headerImage.src = imageUrl;
                    headerImage.classList.remove('hidden');
                }
                if (headerInitials) headerInitials.classList.add('hidden');
                if (dropdownImage) {
                    dropdownImage.src = imageUrl;
                    dropdownImage.classList.remove('hidden');
                }
                if (dropdownInitials) dropdownInitials.classList.add('hidden');
            } else {
                if (headerImage) {
                    headerImage.classList.add('hidden');
                    headerImage.removeAttribute('src');
                }
                if (headerInitials) headerInitials.classList.remove('hidden');
                if (dropdownImage) {
                    dropdownImage.classList.add('hidden');
                    dropdownImage.removeAttribute('src');
                }
                if (dropdownInitials) dropdownInitials.classList.remove('hidden');
            }
        };

        const updatePhotoState = (hasPhoto, imageUrl = null) => {
            if (hasPhoto) {
                imageEl.classList.remove('hidden');
                if (imageUrl) imageEl.src = imageUrl;
                initialsEl.classList.add('hidden');
                if (stateEl) stateEl.textContent = 'Photo added';
                if (removeBtn) removeBtn.disabled = false;
                syncHeaderAvatars(imageUrl || imageEl.src);
            } else {
                imageEl.classList.add('hidden');
                imageEl.removeAttribute('src');
                initialsEl.classList.remove('hidden');
                if (stateEl) stateEl.textContent = 'No photo uploaded';
                if (removeBtn) removeBtn.disabled = true;
                syncHeaderAvatars(null);
            }
        };

        const openFilePicker = () => fileInput.click();

        const openCropModal = (file) => {
            selectedFile = file;
            const reader = new FileReader();
            reader.onload = (event) => {
                cropImage.src = event.target.result;
                cropModal.classList.remove('hidden');
                
                // Initialize cropper with circular aspect ratio
                if (cropper) {
                    cropper.destroy();
                }
                cropper = new Cropper(cropImage, {
                    aspectRatio: 1,
                    viewMode: 1,
                    dragMode: 'move',
                    autoCropArea: 0.8,
                    restore: false,
                    guides: true,
                    center: true,
                    highlight: false,
                    cropBoxMovable: true,
                    cropBoxResizable: true,
                    toggleDragModeOnDblclick: false,
                    minCropBoxWidth: 100,
                    minCropBoxHeight: 100,
                });
            };
            reader.readAsDataURL(file);
        };

        const closeCropModalHandler = () => {
            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
            cropModal.classList.add('hidden');
            cropImage.src = '';
            fileInput.value = '';
            selectedFile = null;
        };

        const uploadCroppedImage = () => {
            if (!cropper || !selectedFile) return;

            // Get cropped canvas
            const canvas = cropper.getCroppedCanvas({
                width: 400,
                height: 400,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high',
            });

            canvas.toBlob((blob) => {
                if (!blob) {
                    showNotification('Failed to crop image.', 'error');
                    return;
                }

                // Create FormData with cropped image
                const formData = new FormData();
                formData.append('profile_image', blob, selectedFile.name);
                formData.append('csrfmiddlewaretoken', document.querySelector('[name=csrfmiddlewaretoken]')?.value || '');

                // Show loading state
                if (saveCrop) {
                    saveCrop.disabled = true;
                    saveCrop.textContent = 'Uploading...';
                }

                fetch('/manager/upload-profile-image/', {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin'
                })
                .then(response => response.json())
                .then(data => {
                    if (saveCrop) {
                        saveCrop.disabled = false;
                        saveCrop.textContent = 'Save Crop';
                    }
                    
                    if (data.success) {
                        updatePhotoState(true, data.image_url);
                        closeCropModalHandler();
                        const successMsg = data.notification?.message || data.message || 'Profile photo uploaded successfully.';
                        showNotification(successMsg, 'success');
                    } else {
                        const errorMsg = data.notification?.message || data.message || 'Failed to upload photo.';
                        showNotification(errorMsg, 'error');
                    }
                })
                .catch(error => {
                    if (saveCrop) {
                        saveCrop.disabled = false;
                        saveCrop.textContent = 'Save Crop';
                    }
                    showNotification('Failed to upload photo. Please try again.', 'error');
                });
            }, 'image/jpeg', 0.95);
        };

        const handleFileChange = () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                updatePhotoState(false);
                showNotification('No photo selected.', 'info');
                return;
            }

            // Validate file type
            if (!file.type.startsWith('image/')) {
                showNotification('Please select an image file.', 'error');
                fileInput.value = '';
                return;
            }

            // Open crop modal instead of uploading directly
            openCropModal(file);
        };

        const removePhoto = () => {
            fetch('/manager/remove-profile-image/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value || ''
                },
                credentials: 'same-origin'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    fileInput.value = '';
                    updatePhotoState(false);
                    const successMsg = data.notification?.message || data.message || 'Profile photo removed.';
                    showNotification(successMsg, 'success');
                } else {
                    const errorMsg = data.notification?.message || data.message || 'Failed to remove photo.';
                    showNotification(errorMsg, 'error');
                }
            })
            .catch(error => {
                showNotification('Failed to remove photo. Please try again.', 'error');
            });
        };

        const setEditing = (isEditing) => {
            editableFields.forEach((field) => {
                // Skip email field - it should always remain disabled for managers
                if (field.id === 'email') {
                    return;
                }
                field.disabled = !isEditing;
                if (isEditing) {
                    field.dataset.originalValue = field.value;
                    field.classList.add('bg-white', 'border-gray-300');
                } else {
                    field.classList.remove('bg-white', 'border-gray-300');
                }
            });

            if (editBtn) editBtn.classList.toggle('hidden', isEditing);
            if (saveBtn) saveBtn.classList.toggle('hidden', !isEditing);
            if (cancelBtn) cancelBtn.classList.toggle('hidden', !isEditing);
        };

        const cancelEditing = () => {
            editableFields.forEach((field) => {
                if (field.dataset.originalValue !== undefined) {
                    field.value = field.dataset.originalValue;
                }
            });
            setEditing(false);
        };

        if (editBtn) {
            editBtn.addEventListener('click', () => setEditing(true));
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', cancelEditing);
        }

        // Notifications from server (profile updated / errors)
        if (notifyNode) {
            const updated = notifyNode.getAttribute('data-updated') === 'true';
            const errorsRaw = notifyNode.getAttribute('data-errors');

            if (updated) {
                showNotification('Profile updated.', 'success');
            }

            if (errorsRaw) {
                errorsRaw.split('||').forEach((err) => {
                    const trimmed = err.trim();
                    if (trimmed) showNotification(trimmed, 'error');
                });
            }
        }

        avatarButton.addEventListener('click', openFilePicker);
        avatarButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openFilePicker();
            }
        });

        fileInput.addEventListener('change', handleFileChange);
        if (removeBtn) removeBtn.addEventListener('click', removePhoto);
        
        // Cropper modal event listeners
        if (closeCropModal) {
            closeCropModal.addEventListener('click', closeCropModalHandler);
        }
        if (cancelCrop) {
            cancelCrop.addEventListener('click', closeCropModalHandler);
        }
        if (saveCrop) {
            saveCrop.addEventListener('click', uploadCroppedImage);
        }
        
        // Close modal on backdrop click
        if (cropModal) {
            cropModal.addEventListener('click', (e) => {
                if (e.target === cropModal) {
                    closeCropModalHandler();
                }
            });
        }
        
        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && cropModal && !cropModal.classList.contains('hidden')) {
                closeCropModalHandler();
            }
        });
    });
})();

