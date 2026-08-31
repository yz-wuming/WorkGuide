from importlib.metadata import distribution


def test_installed_distribution_exposes_workguide_extension_entry_point() -> None:
    entry_points = [entry_point for entry_point in distribution("workguide-extension-example").entry_points if entry_point.group == "workguide.extensions"]

    assert [(entry_point.name, entry_point.value) for entry_point in entry_points] == [("example", "workguide_extension_example:install")]

    install = entry_points[0].load()
    assert install.__workguide_api__ == "0.2.0"
    assert install.__workguide_name__ == "example"
