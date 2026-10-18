import unittest

try:
    from .alert_logic import PedestrianAlertController
except ImportError:
    from alert_logic import PedestrianAlertController


class PedestrianAlertControllerTests(unittest.TestCase):
    def setUp(self):
        self.controller = PedestrianAlertController(12, 8, 5)
        self.zone = (0.0, 0.0, 1.0, 1.0)

    def test_single_person_waits_twelve_seconds(self):
        first = self.controller.update(1, self.zone, 0)
        self.assertFalse(first["trigger"])
        self.assertTrue(first["pending"])
        self.assertFalse(self.controller.update(1, self.zone, 11.99)["trigger"])
        self.assertTrue(self.controller.update(1, self.zone, 12)["trigger"])

    def test_second_person_uses_eight_seconds_without_resetting_elapsed_time(self):
        self.controller.update(1, self.zone, 0)
        self.assertFalse(self.controller.update(1, self.zone, 10)["trigger"])
        self.assertTrue(self.controller.update(2, self.zone, 10)["trigger"])

    def test_three_people_use_five_seconds(self):
        self.controller.update(3, self.zone, 0)
        self.assertFalse(self.controller.update(3, self.zone, 4.99)["trigger"])
        self.assertTrue(self.controller.update(3, self.zone, 5)["trigger"])

    def test_detection_area_change_restarts_full_cooldown(self):
        other_zone = (0.2, 0.2, 0.5, 0.5)
        self.controller.update(3, self.zone, 0)
        self.assertFalse(self.controller.update(3, other_zone, 10)["trigger"])
        self.assertFalse(self.controller.update(3, other_zone, 14.99)["trigger"])
        self.assertTrue(self.controller.update(3, other_zone, 15)["trigger"])

    def test_countdown_waits_for_alert_playback_to_finish(self):
        self.controller.update(3, self.zone, 0)
        self.assertTrue(self.controller.update(3, self.zone, 5)["trigger"])
        during_playback = self.controller.update(3, self.zone, 30)
        self.assertFalse(during_playback["trigger"])
        self.assertFalse(during_playback["pending"])
        self.controller.finish_alert()
        self.assertTrue(self.controller.update(3, self.zone, 30)["pending"])
        self.assertFalse(self.controller.update(3, self.zone, 34.99)["trigger"])
        self.assertTrue(self.controller.update(3, self.zone, 35)["trigger"])

    def test_empty_area_cancels_pending_countdown(self):
        self.controller.update(1, self.zone, 0)
        self.assertFalse(self.controller.update(0, self.zone, 5)["pending"])
        self.assertFalse(self.controller.update(1, self.zone, 6)["trigger"])
        self.assertFalse(self.controller.update(1, self.zone, 17.99)["trigger"])
        self.assertTrue(self.controller.update(1, self.zone, 18)["trigger"])


if __name__ == "__main__":
    unittest.main()
