import type { CalendarShowtime, ScheduleAuditorium } from "./scheduling-calendar";

const START_HOUR = 10;
const TOTAL_HOURS = 18;
const SLOT_MINUTES = 5;

interface ExportScheduleOptions {
  locationName: string;
  selectedDate: string;
  view: "day" | "week";
  auditoriums: ScheduleAuditorium[];
  showtimes: CalendarShowtime[];
}

function startOfCinemaDay(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00`) : new Date(value);
  date.setHours(START_HOUR, 0, 0, 0);
  return date;
}

function formatDate(date: Date) {
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function safeSheetName(date: Date) {
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }).slice(0, 31);
}

function statusLabel(showtime: CalendarShowtime) {
  if (new Date(showtime.startsAt) < new Date()) return "Past";
  return showtime.onSale ? "Open for sale" : "Closed draft";
}

export async function downloadScheduleWorkbook({
  locationName,
  selectedDate,
  view,
  auditoriums,
  showtimes,
}: ExportScheduleOptions) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "Attend";
  workbook.title = `${locationName} schedule`;
  workbook.subject = view === "week" ? "Weekly cinema schedule" : "Daily cinema schedule";
  workbook.created = new Date();

  const firstDay = startOfCinemaDay(selectedDate);
  const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(date.getDate() + index);
    return date;
  });

  for (const dayStart of days) {
    const dayEnd = new Date(dayStart.getTime() + TOTAL_HOURS * 60 * 60000);
    const dayShowtimes = showtimes
      .filter((showtime) => {
        const startsAt = new Date(showtime.startsAt);
        return startsAt >= dayStart && startsAt < dayEnd;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const sheet = workbook.addWorksheet(safeSheetName(dayStart), {
      views: [{ state: "frozen", xSplit: 1, ySplit: 6 }],
      properties: { defaultRowHeight: 18 },
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: false }];

    const lastColumn = Math.max(2, auditoriums.length + 1);
    sheet.mergeCells(1, 1, 1, lastColumn);
    const title = sheet.getCell(1, 1);
    title.value = `${locationName} · ${formatDate(dayStart)}`;
    title.font = { name: "Georgia", size: 20, bold: true, color: { argb: "FFF4EFE5" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C1118" } };
    title.alignment = { vertical: "middle" };
    sheet.getRow(1).height = 34;

    sheet.mergeCells(2, 1, 2, lastColumn);
    const summary = sheet.getCell(2, 1);
    summary.value = `${dayShowtimes.length} showings · ${auditoriums.length} rooms · cinema day starts at 10:00 AM`;
    summary.font = { size: 10, italic: true, color: { argb: "FF655E57" } };
    summary.alignment = { vertical: "middle" };
    sheet.getRow(2).height = 22;

    const scheduleHeaderRow = 5;
    sheet.getCell(scheduleHeaderRow, 1).value = "Time";
    auditoriums.forEach((auditorium, index) => {
      sheet.getCell(scheduleHeaderRow, index + 2).value = `${auditorium.name} (${auditorium.capacity} seats)`;
    });
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = sheet.getCell(scheduleHeaderRow, column);
      cell.font = { bold: true, color: { argb: "FFF4EFE5" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF28201B" } };
      cell.border = { bottom: { style: "medium", color: { argb: "FFC4B39E" } } };
      cell.alignment = { vertical: "middle", horizontal: column === 1 ? "right" : "left" };
    }
    sheet.getRow(scheduleHeaderRow).height = 26;
    sheet.getColumn(1).width = 12;
    auditoriums.forEach((_, index) => { sheet.getColumn(index + 2).width = 27; });

    const totalSlots = (TOTAL_HOURS * 60) / SLOT_MINUTES;
    for (let slot = 0; slot < totalSlots; slot += 1) {
      const rowNumber = scheduleHeaderRow + 1 + slot;
      const slotStart = new Date(dayStart.getTime() + slot * SLOT_MINUTES * 60000);
      const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60000);
      const row = sheet.getRow(rowNumber);
      row.height = 13;
      const timeCell = row.getCell(1);
      timeCell.value = slotStart;
      timeCell.numFmt = "h:mm AM/PM";
      timeCell.font = { size: 8, color: { argb: slot % 12 === 0 ? "FF332D28" : "FF8D857D" } };
      timeCell.alignment = { vertical: "middle", horizontal: "right" };
      if (slot % 12 !== 0) timeCell.value = null;

      auditoriums.forEach((auditorium, auditoriumIndex) => {
        const cell = row.getCell(auditoriumIndex + 2);
        const showtime = dayShowtimes.find((item) => {
          if (item.auditorium.id !== auditorium.id) return false;
          const startsAt = new Date(item.startsAt);
          const roomReadyAt = new Date(item.roomReadyAt);
          return startsAt < slotEnd && roomReadyAt > slotStart;
        });
        if (!showtime) return;
        const startsAt = new Date(showtime.startsAt);
        const featureStartsAt = new Date(showtime.featureStartsAt);
        const endsAt = new Date(showtime.endsAt);
        const isFirstSlot = startsAt >= slotStart && startsAt < slotEnd;
        const isFeatureStart = featureStartsAt >= slotStart && featureStartsAt < slotEnd;
        const isCleaningStart = endsAt >= slotStart && endsAt < slotEnd;
        const phase = slotStart < featureStartsAt ? "seating" : slotStart < endsAt ? "film" : "cleaning";
        const colors = phase === "seating"
          ? { fill: "FFF3D6A0", font: "FF3D2D16" }
          : phase === "cleaning"
            ? { fill: "FFD8D2CB", font: "FF514C47" }
            : showtime.onSale
              ? { fill: "FF2F7D58", font: "FFFFFFFF" }
              : { fill: "FFD39A3A", font: "FF241B0D" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.fill } };
        cell.font = { size: 8, bold: isFirstSlot || isFeatureStart || isCleaningStart, color: { argb: colors.font } };
        cell.alignment = { vertical: "middle", wrapText: false };
        if (isFirstSlot) cell.value = `${showtime.movie.title} · Doors ${startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
        else if (isFeatureStart) cell.value = `${showtime.movie.title} · Feature`;
        else if (isCleaningStart) cell.value = "Cleaning";
      });

      if (slot % 12 === 0) {
        for (let column = 1; column <= lastColumn; column += 1) {
          row.getCell(column).border = { top: { style: "thin", color: { argb: "FFC9BDAE" } } };
        }
      }
    }

    const detailStart = scheduleHeaderRow + 2 + totalSlots;
    const details = ["Film", "Runtime", "Theater", "Doors", "Feature", "Film ends", "Room ready", "Sale status"];
    details.forEach((label, index) => {
      const cell = sheet.getCell(detailStart, index + 1);
      cell.value = label;
      cell.font = { bold: true, color: { argb: "FFF4EFE5" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF28201B" } };
    });
    dayShowtimes.forEach((showtime, index) => {
      const row = sheet.getRow(detailStart + index + 1);
      row.values = [
        showtime.movie.title,
        showtime.movie.runtimeMinutes,
        showtime.auditorium.name,
        new Date(showtime.startsAt),
        new Date(showtime.featureStartsAt),
        new Date(showtime.endsAt),
        new Date(showtime.roomReadyAt),
        statusLabel(showtime),
      ];
      [4, 5, 6, 7].forEach((column) => { row.getCell(column).numFmt = "h:mm AM/PM"; });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const rangeLabel = view === "week" ? `week-of-${selectedDate}` : selectedDate;
  anchor.href = url;
  anchor.download = `${locationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-schedule-${rangeLabel}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
