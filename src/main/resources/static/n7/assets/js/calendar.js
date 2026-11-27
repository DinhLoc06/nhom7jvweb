const API_BASE = '/api';
const pageParams = new URLSearchParams(window.location.search);
const audienceParam = pageParams.get('audience');
const personIdParam = pageParams.get('personId') || '';
const DAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const DEFAULT_PERIOD_COUNT = 12;
const today = startOfDay(new Date());
let focusedDate = new Date(today);
let currentView = 'week';
let schedules = [];
let requestId = 0;

const calendarView = document.getElementById('calendarView');
const statusElement = document.getElementById('calendarStatus');
const periodTitle = document.getElementById('periodTitle');
const miniTitle = document.getElementById('miniMonthTitle');
const miniDays = document.getElementById('miniDays');
const searchInput = document.getElementById('eventSearch');
const eventDialog = document.getElementById('eventDialog');
const personalCalendarForm = document.getElementById('personalCalendarForm');
const audienceSelect = document.getElementById('calendarAudience');
const personIdInput = document.getElementById('calendarPersonId');
const addScheduleButton = document.getElementById('addScheduleButton');
const scheduleActions = document.getElementById('scheduleActions');
const scheduleEditorDialog = document.getElementById('scheduleEditorDialog');
const scheduleEditorForm = document.getElementById('scheduleEditorForm');
const scheduleEditorError = document.getElementById('scheduleEditorError');
let editingSchedule = null;
let selectedSchedule = null;
let editorOptionsLoaded = false;

if (audienceParam === 'student' || audienceParam === 'lecturer') audienceSelect.value = audienceParam;
personIdInput.value = personIdParam;
personalCalendarForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!personIdInput.value.trim()) return;
    const params = new URLSearchParams({ audience: audienceSelect.value, personId: personIdInput.value.trim() });
    window.location.search = params.toString();
});

const canManageSchedules = Boolean(personIdParam && ['student', 'lecturer'].includes(audienceParam));
addScheduleButton.hidden = !canManageSchedules;
addScheduleButton.addEventListener('click', () => openScheduleEditor());
document.getElementById('editScheduleButton').addEventListener('click', () => {
    if (selectedSchedule) openScheduleEditor(selectedSchedule);
});
document.getElementById('deleteScheduleButton').addEventListener('click', deleteSelectedSchedule);
document.getElementById('closeScheduleEditor').addEventListener('click', () => scheduleEditorDialog.close());
document.getElementById('cancelScheduleEditor').addEventListener('click', () => scheduleEditorDialog.close());
scheduleEditorForm.addEventListener('submit', saveSchedule);

document.getElementById('todayButton').addEventListener('click', () => navigateTo(today));
document.getElementById('prevPeriod').addEventListener('click', () => shiftPeriod(-1));
document.getElementById('nextPeriod').addEventListener('click', () => shiftPeriod(1));
document.getElementById('miniPrev').addEventListener('click', () => shiftMiniMonth(-1));
document.getElementById('miniNext').addEventListener('click', () => shiftMiniMonth(1));
searchInput.addEventListener('input', renderCalendar);
document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
        currentView = button.dataset.view;
        document.querySelectorAll('[data-view]').forEach((viewButton) => {
            viewButton.classList.toggle('active', viewButton === button);
        });
        loadSchedules();
    });
});

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function mondayOf(date) {
    const day = (date.getDay() + 6) % 7;
    return addDays(startOfDay(date), -day);
}

function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseDate(value) {
    return value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : null;
}

function sameDate(first, second) {
    return first.getFullYear() === second.getFullYear()
        && first.getMonth() === second.getMonth()
        && first.getDate() === second.getDate();
}

function formatMonthYear(date) {
    return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(date);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function eventName(schedule) {
    return schedule.courseName || schedule.courseSectionName || schedule.courseCode || 'Buổi học';
}

function modeLabel(schedule) {
    const mode = String(schedule.mode || '').trim();
    if (!mode) return '';
    const normalized = mode.toLocaleLowerCase('vi');
    if (normalized.includes('online') || normalized.includes('trực tuyến')) return 'Online';
    if (normalized.includes('trực tiếp') || normalized.includes('offline')) return 'Trực tiếp';
    return mode;
}

function eventSearchText(schedule) {
    return [
        schedule.courseName, schedule.courseCode, schedule.courseSectionName,
        schedule.courseSectionCode, schedule.roomName, schedule.roomCode,
        schedule.buildingName, schedule.lecturerName
    ].join(' ').toLocaleLowerCase('vi');
}

function colorClass(schedule) {
    const key = schedule.courseCode || schedule.courseSectionCode || schedule.courseSectionId || '';
    let hash = 0;
    for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return `color-${Math.abs(hash) % 5}`;
}

function visibleEvents() {
    const query = searchInput.value.trim().toLocaleLowerCase('vi');
    return schedules.filter((schedule) => !query || eventSearchText(schedule).includes(query));
}

function setStatus(message = '', isError = false) {
    statusElement.textContent = message;
    statusElement.hidden = !message;
    statusElement.classList.toggle('error', isError);
}

async function loadSchedules() {
    const currentRequest = ++requestId;
    const dates = currentView === 'week'
        ? [mondayOf(focusedDate)]
        : Array.from({ length: 6 }, (_, index) => addDays(monthRangeStart(focusedDate), index * 7));
    setStatus('Đang tải lịch học…');
    calendarView.innerHTML = '';

    try {
        const weeks = await Promise.all(dates.map(async (date) => {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personIdParam);
            const schedulePath = personIdParam && (audienceParam === 'student' || audienceParam === 'lecturer')
                ? `/schedules/${audienceParam}/${isUuid ? '' : 'by-code/'}${encodeURIComponent(personIdParam)}/weekly`
                : '/schedules/weekly';
            const url = `${API_BASE}${schedulePath}?date=${encodeURIComponent(toIsoDate(date))}`;
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) {
                if (response.status === 404 && audienceParam === 'student') {
                    throw new Error(`Mã ${personIdParam} chưa có hồ sơ học vụ hoặc lịch đăng ký. Hãy chọn sinh viên có lớp học phần.`);
                }
                throw new Error(`Máy chủ phản hồi ${response.status}`);
            }
            return response.json();
        }));
        if (currentRequest !== requestId) return;
        if (weeks.some((week) => !Array.isArray(week))) throw new Error('Dữ liệu lịch học trả về không đúng định dạng');
        schedules = [...new Map(weeks.flat().map((schedule) => [schedule.id, schedule])).values()];
        setStatus();
        renderCalendar();
    } catch (error) {
        if (currentRequest !== requestId) return;
        schedules = [];
        renderCalendar();
        setStatus(`Không thể tải lịch học. ${error.message}`, true);
    }
}

async function loadEditorOptions() {
    if (editorOptionsLoaded) return;
    const code = encodeURIComponent(personIdParam);
    const sectionPath = audienceParam === 'student'
        ? `/schedules/student/by-code/${code}/course-sections`
        : `/schedules/lecturer/by-code/${code}/course-sections`;
    const [sectionResponse, roomResponse] = await Promise.all([
        fetch(`${API_BASE}${sectionPath}`, { headers: { Accept: 'application/json' } }),
        fetch(`${API_BASE}/rooms?active=true&size=200`, { headers: { Accept: 'application/json' } })
    ]);
    if (!sectionResponse.ok) {
        if (audienceParam === 'student' && sectionResponse.status === 404) {
            throw new Error(`Mã ${personIdParam} chưa có hồ sơ học vụ. Hãy chọn sinh viên có lớp học phần.`);
        }
        if (audienceParam === 'lecturer' && sectionResponse.status === 404) {
            throw new Error(`Không tìm thấy hồ sơ giảng viên ${personIdParam}.`);
        }
        throw new Error(`Không tải được danh sách lớp học phần (HTTP ${sectionResponse.status}).`);
    }
    if (!roomResponse.ok) throw new Error(`Không tải được danh sách phòng học (HTTP ${roomResponse.status}).`);
    const sections = await sectionResponse.json();
    const roomPayload = await roomResponse.json();
    const rooms = Array.isArray(roomPayload) ? roomPayload : roomPayload.content || [];
    document.getElementById('editorCourseSection').innerHTML = sections.map((section) =>
        `<option value="${escapeHtml(section.id)}">${escapeHtml([section.code, section.name, section.courseName].filter(Boolean).join(' · '))}</option>`
    ).join('');
    document.getElementById('editorRoom').innerHTML = rooms.map((room) =>
        `<option value="${escapeHtml(room.id)}">${escapeHtml([room.roomCode, room.roomName].filter(Boolean).join(' · '))}</option>`
    ).join('');
    if (!sections.length) {
        throw new Error(audienceParam === 'student'
            ? `Sinh viên ${personIdParam} chưa có lớp học phần đã đăng ký.`
            : 'Không tìm thấy lớp học phần phù hợp với đối tượng này.');
    }
    if (!rooms.length) throw new Error('Không tìm thấy phòng học đang hoạt động.');
    editorOptionsLoaded = true;
}

async function openScheduleEditor(schedule = null) {
    if (!canManageSchedules) return;
    try {
        scheduleEditorError.hidden = true;
        await loadEditorOptions();
        editingSchedule = schedule;
        document.getElementById('scheduleEditorTitle').textContent = schedule ? 'Sửa lịch học' : 'Thêm lịch học';
        document.getElementById('saveScheduleButton').textContent = schedule ? 'Lưu thay đổi' : 'Thêm lịch';
        document.getElementById('editorCourseSection').value = schedule?.courseSectionId || '';
        document.getElementById('editorRoom').value = schedule?.roomId || '';
        document.getElementById('editorDay').value = String(schedule?.dayOfWeek || ((focusedDate.getDay() + 6) % 7 + 1));
        document.getElementById('editorStartPeriod').value = schedule?.startPeriod || 1;
        document.getElementById('editorEndPeriod').value = schedule?.endPeriod || 3;
        const monday = mondayOf(focusedDate);
        const defaultStart = toIsoDate(monday);
        const defaultEnd = toIsoDate(addDays(monday, 90));
        document.getElementById('editorStartDate').value = schedule?.startDate?.slice(0, 10) || defaultStart;
        document.getElementById('editorEndDate').value = schedule?.endDate?.slice(0, 10) || defaultEnd;
        document.getElementById('editorMode').value = schedule?.mode || 'Trực tiếp';
        document.getElementById('editorNote').value = schedule?.note || '';
        if (!scheduleEditorDialog.open) scheduleEditorDialog.showModal();
    } catch (error) {
        scheduleEditorError.textContent = error.message;
        scheduleEditorError.hidden = false;
        if (!scheduleEditorDialog.open) scheduleEditorDialog.showModal();
    }
}

async function saveSchedule(event) {
    event.preventDefault();
    scheduleEditorError.hidden = true;
    const startPeriod = Number(document.getElementById('editorStartPeriod').value);
    const endPeriod = Number(document.getElementById('editorEndPeriod').value);
    if (endPeriod < startPeriod) {
        scheduleEditorError.textContent = 'Tiết kết thúc phải lớn hơn hoặc bằng tiết bắt đầu.';
        scheduleEditorError.hidden = false;
        return;
    }
    const startDate = document.getElementById('editorStartDate').value;
    const endDate = document.getElementById('editorEndDate').value;
    const startTime = editingSchedule?.startDate?.slice(11, 19) || '00:00:00';
    const endTime = editingSchedule?.endDate?.slice(11, 19) || '00:00:00';
    const payload = {
        courseSectionId: document.getElementById('editorCourseSection').value,
        roomId: document.getElementById('editorRoom').value,
        dayOfWeek: Number(document.getElementById('editorDay').value),
        startPeriod,
        endPeriod,
        numberOfPeriods: endPeriod - startPeriod + 1,
        startDate: `${startDate}T${startTime}`,
        endDate: `${endDate}T${endTime}`,
        mode: document.getElementById('editorMode').value.trim() || null,
        note: document.getElementById('editorNote').value.trim() || null,
        active: true
    };
    const personPath = `/schedules/${audienceParam}/by-code/${encodeURIComponent(personIdParam)}`;
    const url = editingSchedule ? `${API_BASE}${personPath}/${encodeURIComponent(editingSchedule.id)}` : `${API_BASE}${personPath}`;
    try {
        const response = await fetch(url, {
            method: editingSchedule ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        scheduleEditorDialog.close();
        document.getElementById('eventDialog').close();
        await loadSchedules();
    } catch (error) {
        scheduleEditorError.textContent = error.message;
        scheduleEditorError.hidden = false;
    }
}

async function deleteSelectedSchedule() {
    if (!selectedSchedule || !canManageSchedules) return;
    if (!window.confirm('Xóa lịch này? Lịch gắn với lớp học phần nên thao tác có thể ảnh hưởng các sinh viên hoặc giảng viên khác cùng lớp.')) return;
    const url = `${API_BASE}/schedules/${audienceParam}/by-code/${encodeURIComponent(personIdParam)}/${encodeURIComponent(selectedSchedule.id)}`;
    try {
        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) throw new Error(await responseMessage(response));
        document.getElementById('eventDialog').close();
        selectedSchedule = null;
        await loadSchedules();
    } catch (error) {
        setStatus(`Không xóa được lịch. ${error.message}`, true);
    }
}

async function responseMessage(response) {
    const body = await response.text();
    const conflictMessage = 'Lịch bị trùng phòng, ngày hoặc tiết với lịch khác. Chưa có thay đổi nào được lưu.';
    if (!body) return response.status === 409 ? conflictMessage : `Máy chủ phản hồi ${response.status}`;
    try {
        const parsed = JSON.parse(body);
        const message = parsed.detail || parsed.message;
        if (response.status === 409 && (!message || message === 'Conflict')) return conflictMessage;
        return message || parsed.error || body;
    } catch {
        return response.status === 409 && body === 'Conflict' ? conflictMessage : body;
    }
}

function updateTitle() {
    if (currentView === 'week') {
        const start = mondayOf(focusedDate);
        const end = addDays(start, 6);
        if (start.getMonth() === end.getMonth()) {
            periodTitle.textContent = `${start.getDate()} – ${end.getDate()} ${formatMonthYear(end)}`;
        } else {
            periodTitle.textContent = `${start.getDate()} ${new Intl.DateTimeFormat('vi-VN', { month: 'short' }).format(start)} – ${end.getDate()} ${formatMonthYear(end)}`;
        }
    } else {
        periodTitle.textContent = formatMonthYear(focusedDate);
    }
}

function renderMiniCalendar() {
    miniTitle.textContent = formatMonthYear(focusedDate);
    const firstDay = new Date(focusedDate.getFullYear(), focusedDate.getMonth(), 1);
    const firstCell = mondayOf(firstDay);
    miniDays.innerHTML = Array.from({ length: 42 }, (_, index) => {
        const date = addDays(firstCell, index);
        const classes = [
            'mini-day',
            date.getMonth() !== focusedDate.getMonth() ? 'outside' : '',
            sameDate(date, today) ? 'today' : '',
            sameDate(date, focusedDate) ? 'selected' : ''
        ].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-date="${toIsoDate(date)}" aria-label="${escapeHtml(date.toLocaleDateString('vi-VN'))}">${date.getDate()}</button>`;
    }).join('');
    miniDays.querySelectorAll('[data-date]').forEach((button) => {
        button.addEventListener('click', () => navigateTo(parseDate(button.dataset.date)));
    });
}

function renderCalendar() {
    updateTitle();
    renderMiniCalendar();
    if (currentView === 'week') renderWeekView();
    else renderMonthView();
}

function renderWeekView() {
    const weekStart = mondayOf(focusedDate);
    const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const headers = dates.map((date, index) => `
        <div class="week-day-heading ${sameDate(date, today) ? 'today' : ''}">
            <span class="weekday">${DAYS[index]}</span>
            <span class="day-number">${date.getDate()}</span>
        </div>
    `).join('');
    const events = visibleEvents();
    const periodCount = Math.max(
        DEFAULT_PERIOD_COUNT,
        ...events.map((schedule) => Number(schedule.endPeriod || schedule.startPeriod || 0))
    );
    const labels = Array.from({ length: periodCount }, (_, index) =>
        `<div class="period-label">Tiết ${index + 1}</div>`).join('');
    const columns = dates.map((date, columnIndex) => {
        const dayNumber = columnIndex + 1;
        const dayEvents = events
            .filter((schedule) => Number(schedule.dayOfWeek) === dayNumber && occursOn(schedule, date))
            .filter((schedule) => Number(schedule.startPeriod) >= 1)
            .map((schedule) => renderWeekEvent(schedule, date));
        return `<div class="day-column ${sameDate(date, today) ? 'today' : ''}" data-column="${columnIndex + 1}" style="height:${periodCount * 66}px">${dayEvents.join('')}</div>`;
    }).join('');

    calendarView.innerHTML = `
        <div class="week-calendar">
            <div class="week-header"><div class="week-corner"></div>${headers}</div>
            <div class="week-grid"><div class="period-labels">${labels}</div>${columns}</div>
        </div>`;
    calendarView.querySelectorAll('[data-schedule-id]').forEach((button) => {
        button.addEventListener('click', () => showDetails(button.dataset.scheduleId, button.dataset.occurrence));
    });
}

function occursOn(schedule, date) {
    const start = parseDate(schedule.startDate);
    const end = parseDate(schedule.endDate);
    return Boolean(start && end && date >= start && date <= end);
}

function renderWeekEvent(schedule, date) {
    const start = Math.max(1, Number(schedule.startPeriod));
    const end = Math.max(start, Number(schedule.endPeriod || start));
    const top = (start - 1) * 66 + 3;
    const height = (end - start + 1) * 66 - 6;
    const time = `Tiết ${start}${end > start ? `–${end}` : ''}`;
    const location = [schedule.roomCode || schedule.roomName, schedule.buildingName].filter(Boolean).join(' · ');
    const mode = modeLabel(schedule);
    const occurrence = toIsoDate(date);
    return `
        <button type="button" class="day-event ${colorClass(schedule)}" data-schedule-id="${escapeHtml(schedule.id)}" data-occurrence="${occurrence}"
            style="top:${top}px;height:${height}px" title="${escapeHtml(eventName(schedule))}">
            <span class="event-name">${escapeHtml(eventName(schedule))}</span>
            ${mode ? `<span class="event-mode">${escapeHtml(mode)}</span>` : ''}
            ${schedule.lecturerName ? `<span class="event-meta event-lecturer">Giảng viên: ${escapeHtml(schedule.lecturerName)}</span>` : ''}
            <span class="event-meta">${time}${location ? ` · ${escapeHtml(location)}` : ''}</span>
        </button>`;
}

function monthRangeStart(date) {
    return mondayOf(new Date(date.getFullYear(), date.getMonth(), 1));
}

function renderMonthView() {
    const firstCell = monthRangeStart(focusedDate);
    const dates = Array.from({ length: 42 }, (_, index) => addDays(firstCell, index));
    const events = visibleEvents();
    const head = DAYS.map((day) => `<div>${day}</div>`).join('');
    const cells = dates.map((date) => {
        const dayNumber = (date.getDay() + 6) % 7 + 1;
        const dayEvents = events
            .filter((schedule) => Number(schedule.dayOfWeek) === dayNumber && occursOn(schedule, date));
        const shown = dayEvents.slice(0, 3).map((schedule) => `
            <button type="button" class="month-event ${colorClass(schedule)}" data-schedule-id="${escapeHtml(schedule.id)}" data-occurrence="${toIsoDate(date)}"
                title="${escapeHtml([eventName(schedule), schedule.lecturerName ? `Giảng viên: ${schedule.lecturerName}` : ''].filter(Boolean).join(' · '))}">
                <span class="month-event-name">${escapeHtml(eventName(schedule))}</span>
                ${modeLabel(schedule) ? `<span class="month-mode">${escapeHtml(modeLabel(schedule))}</span>` : ''}
            </button>`).join('');
        const more = dayEvents.length > 3 ? `<div class="month-more">+${dayEvents.length - 3} lịch khác</div>` : '';
        return `<div class="month-cell ${date.getMonth() === focusedDate.getMonth() ? '' : 'outside'}">
            <span class="month-date ${sameDate(date, today) ? 'today' : ''}">${date.getDate()}</span>${shown}${more}
        </div>`;
    }).join('');
    calendarView.innerHTML = `<div class="month-calendar"><div class="month-head">${head}</div><div class="month-grid">${cells}</div></div>`;
    calendarView.querySelectorAll('[data-schedule-id]').forEach((button) => {
        button.addEventListener('click', () => showDetails(button.dataset.scheduleId, button.dataset.occurrence));
    });
}

function shiftPeriod(direction) {
    if (currentView === 'week') focusedDate = addDays(focusedDate, direction * 7);
    else focusedDate = new Date(focusedDate.getFullYear(), focusedDate.getMonth() + direction, 1);
    loadSchedules();
}

function shiftMiniMonth(direction) {
    focusedDate = new Date(focusedDate.getFullYear(), focusedDate.getMonth() + direction, Math.min(focusedDate.getDate(), 28));
    loadSchedules();
}

function navigateTo(date) {
    focusedDate = startOfDay(date);
    loadSchedules();
}

function showDetails(id, occurrenceValue) {
    const schedule = schedules.find((item) => String(item.id) === String(id));
    if (!schedule) return;
    selectedSchedule = schedule;
    scheduleActions.hidden = !canManageSchedules;
    const occurrence = parseDate(occurrenceValue) || focusedDate;
    const dateText = new Intl.DateTimeFormat('vi-VN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(occurrence);
    const start = Number(schedule.startPeriod);
    const end = Number(schedule.endPeriod || start);
    const periodText = `Tiết ${start}${end > start ? `–${end}` : ''}`;
    const roomText = [schedule.roomCode, schedule.roomName, schedule.buildingName].filter(Boolean).join(' · ') || 'Chưa có thông tin phòng';
    document.getElementById('dialogCourse').textContent = eventName(schedule);
    document.getElementById('dialogSection').textContent = [schedule.courseCode, schedule.courseSectionName, schedule.courseSectionCode].filter(Boolean).join(' · ');
    document.getElementById('dialogDate').textContent = dateText;
    document.getElementById('dialogPeriod').textContent = periodText;
    const lecturerRow = document.getElementById('dialogLecturerRow');
    lecturerRow.hidden = !schedule.lecturerName;
    document.getElementById('dialogLecturer').textContent = schedule.lecturerName || '';
    const mode = modeLabel(schedule);
    document.getElementById('dialogModeRow').hidden = !mode;
    document.getElementById('dialogMode').textContent = mode;
    document.getElementById('dialogRoom').textContent = roomText;
    const status = schedule.scheduleStatus || schedule.status || '';
    document.getElementById('dialogStatusRow').hidden = !status;
    document.getElementById('dialogStatus').textContent = status;
    const description = document.getElementById('dialogDescription');
    description.textContent = schedule.description || schedule.note || '';
    description.hidden = !description.textContent;
    document.querySelector('.dialog-color-bar').style.backgroundColor = colorHex(schedule);
    if (typeof eventDialog.showModal === 'function') eventDialog.showModal();
}

function colorHex(schedule) {
    const colors = ['#039be5', '#188038', '#d56a00', '#9334e6', '#d93025'];
    const match = colorClass(schedule).match(/\d/);
    return colors[Number(match?.[0] || 0)];
}

loadSchedules();
