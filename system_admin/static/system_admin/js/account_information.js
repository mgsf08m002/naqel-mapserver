(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('.account-page');
        const editBtn = document.getElementById('editBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const editableFields = document.querySelectorAll('.editable-field');
        const avatarButton = document.getElementById('profileAvatar');
        const fileInput = document.getElementById('profileInput');
        const imageEl = document.getElementById('profileImage');
        const initialsEl = document.getElementById('profileInitials');
        const removeBtn = document.getElementById('removePhotoBtn');
        const stateEl = document.getElementById('photoState');
        const cropModal = document.getElementById('cropModal');
        const cropImage = document.getElementById('cropImage');
        const closeCropModal = document.getElementById('closeCropModal');
        const cancelCrop = document.getElementById('cancelCrop');
        const saveCrop = document.getElementById('saveCrop');

        if (!page) return;

        const uploadUrl = page.dataset.uploadUrl || '';
        const removeUrl = page.dataset.removeUrl || '';
        const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || '';
        let cropper = null;
        let selectedFile = null;

        const csrfHeader = () => ({
            'X-CSRFToken': csrfToken,
        });

        const setEditing = (isEditing) => {
            page.classList.toggle('is-editing', isEditing);
            editableFields.forEach((field) => {
                if (isEditing) {
                    field.dataset.originalValue = field.value;
                    field.disabled = false;
                } else {
                    field.disabled = true;
                }
            });
            if (isEditing) {
                const first = editableFields[0];
                if (first) first.focus();
            }
        };

        const cancelEditing = () => {
            editableFields.forEach((field) => {
                if (field.dataset.originalValue !== undefined) {
                    field.value = field.dataset.originalValue;
                }
            });
            setEditing(false);
        };

        if (page.classList.contains('is-editing')) {
            setEditing(true);
        }

        if (editBtn) {
            editBtn.addEventListener('click', () => setEditing(true));
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', cancelEditing);
        }

        if (!avatarButton || !fileInput || !imageEl || !initialsEl) return;

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
                imageEl.classList.remove('is-hidden');
                if (imageUrl) imageEl.src = imageUrl;
                initialsEl.classList.add('is-hidden');
                if (stateEl) stateEl.textContent = 'Photo added';
                if (removeBtn) removeBtn.disabled = false;
                syncHeaderAvatars(imageUrl || imageEl.src);
            } else {
                imageEl.classList.add('is-hidden');
                imageEl.removeAttribute('src');
                initialsEl.classList.remove('is-hidden');
                if (stateEl) stateEl.textContent = 'No photo uploaded';
                if (removeBtn) removeBtn.disabled = true;
                syncHeaderAvatars(null);
            }
        };

        const closeCropModalHandler = () => {
            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
            if (cropModal) cropModal.classList.add('is-hidden');
            if (cropImage) cropImage.src = '';
            fileInput.value = '';
            selectedFile = null;
        };

        const openCropModal = (file) => {
            if (typeof Cropper === 'undefined' || !cropModal || !cropImage) {
                window.notify.tryShow('Image cropper failed to load.', 'error');
                return;
            }
            selectedFile = file;
            const reader = new FileReader();
            reader.onload = (event) => {
                cropImage.src = event.target.result;
                cropModal.classList.remove('is-hidden');
                if (cropper) cropper.destroy();
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

        const uploadCroppedImage = () => {
            if (!cropper || !selectedFile) return;
            const canvas = cropper.getCroppedCanvas({
                width: 400,
                height: 400,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high',
            });
            canvas.toBlob((blob) => {
                if (!blob) {
                    window.notify.tryShow('Failed to crop image.', 'error');
                    return;
                }
                const formData = new FormData();
                formData.append('profile_image', blob, selectedFile.name);
                formData.append('csrfmiddlewaretoken', csrfToken);
                if (saveCrop) {
                    saveCrop.disabled = true;
                    saveCrop.textContent = 'Uploading...';
                }
                fetch(uploadUrl, {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin',
                })
                    .then((response) => response.json())
                    .then((data) => {
                        if (saveCrop) {
                            saveCrop.disabled = false;
                            saveCrop.textContent = 'Save Crop';
                        }
                        if (data.success) {
                            updatePhotoState(true, data.image_url);
                            closeCropModalHandler();
                            window.notify.tryShow(
                                data.notification?.message || data.message || 'Profile photo uploaded successfully.',
                                'success'
                            );
                        } else {
                            window.notify.tryShow(
                                data.notification?.message || data.message || 'Failed to upload photo.',
                                'error'
                            );
                        }
                    })
                    .catch(() => {
                        if (saveCrop) {
                            saveCrop.disabled = false;
                            saveCrop.textContent = 'Save Crop';
                        }
                        window.notify.tryShow('Failed to upload photo. Please try again.', 'error');
                    });
            }, 'image/jpeg', 0.95);
        };

        avatarButton.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                window.notify.tryShow('Please select an image file.', 'error');
                fileInput.value = '';
                return;
            }
            openCropModal(file);
        });

        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                fetch(removeUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...csrfHeader(),
                    },
                    credentials: 'same-origin',
                })
                    .then((response) => response.json())
                    .then((data) => {
                        if (data.success) {
                            fileInput.value = '';
                            updatePhotoState(false);
                            window.notify.tryShow(
                                data.notification?.message || data.message || 'Profile photo removed.',
                                'success'
                            );
                        } else {
                            window.notify.tryShow(
                                data.notification?.message || data.message || 'Failed to remove photo.',
                                'error'
                            );
                        }
                    })
                    .catch(() => {
                        window.notify.tryShow('Failed to remove photo. Please try again.', 'error');
                    });
            });
        }

        if (closeCropModal) closeCropModal.addEventListener('click', closeCropModalHandler);
        if (cancelCrop) cancelCrop.addEventListener('click', closeCropModalHandler);
        if (saveCrop) saveCrop.addEventListener('click', uploadCroppedImage);
        if (cropModal) {
            cropModal.addEventListener('click', (event) => {
                if (event.target === cropModal) closeCropModalHandler();
            });
        }
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && cropModal && !cropModal.classList.contains('is-hidden')) {
                closeCropModalHandler();
            }
        });
    });
})();
