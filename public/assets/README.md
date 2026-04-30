# Alwan Assets

This folder contains default emojis and activities that users can customize later.

## Files

### default-moods.json
Contains the default mood options with:
- `emoji`: The emoji representing the mood
- `label`: The text label for the mood
- `color`: The hex color code for the mood

### default-activities.json
Contains the default activity options with:
- `emoji`: The emoji representing the activity
- `label`: The text label for the activity

## Customization

Users can customize these through the dashboard by:
1. Opening the mood picker modal
2. Clicking the "Edit" button
3. Modifying moods and activities
4. Adding new custom activities
5. Resetting to defaults anytime

All customizations are stored in the browser's localStorage:
- `psyc_custom_moods` - User's customized moods
- `psyc_custom_activities` - User's customized activities
