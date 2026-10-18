class PedestrianAlertController:
    """Track adaptive dwell time and serialize alerts behind alert playback."""

    def __init__(self, one_person_seconds=12.0, two_persons_seconds=8.0, three_or_more_seconds=5.0):
        self.one_person_seconds = max(0.0, float(one_person_seconds))
        self.two_persons_seconds = max(0.0, float(two_persons_seconds))
        self.three_or_more_seconds = max(0.0, float(three_or_more_seconds))
        self.zone_key = None
        self.started_at = None
        self.alert_playing = False

    def update(self, people_count, zone_key, now):
        if zone_key != self.zone_key:
            self.zone_key = zone_key
            self.started_at = None

        if people_count <= 0:
            self.started_at = None
            return {"trigger": False, "pending": False, "alert_playing": self.alert_playing}

        if self.alert_playing:
            return {"trigger": False, "pending": False, "alert_playing": True}

        if people_count == 1:
            current_requirement = self.one_person_seconds
        elif people_count == 2:
            current_requirement = self.two_persons_seconds
        else:
            current_requirement = self.three_or_more_seconds
        if self.started_at is None:
            self.started_at = now

        if now - self.started_at >= current_requirement:
            self.alert_playing = True
            self.started_at = None
            return {"trigger": True, "pending": False, "alert_playing": True}

        return {"trigger": False, "pending": True, "alert_playing": False}

    def finish_alert(self):
        self.alert_playing = False
        self.started_at = None
