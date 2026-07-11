import 'dart:convert';

import 'package:flutter/services.dart';

/// Loads nested JSON translation files and resolves dot-path keys.
class AppLocalizations {
  AppLocalizations._(this.localeCode, this._data, this._fallback);

  final String localeCode;
  final Map<String, dynamic> _data;
  final Map<String, dynamic> _fallback;

  static const supportedCodes = ['AR', 'EN', 'KU', 'TR'];

  static String assetForCode(String code) {
    final lang = switch (code.toUpperCase()) {
      'AR' => 'ar',
      'KU' => 'ku',
      'TR' => 'tr',
      _ => 'en',
    };
    return 'assets/l10n/$lang.json';
  }

  static Future<AppLocalizations> load(String code) async {
    final upper = code.toUpperCase();
    final raw = await rootBundle.loadString(assetForCode(upper));
    final data = jsonDecode(raw) as Map<String, dynamic>;
    Map<String, dynamic> fallback = data;
    if (upper != 'EN') {
      final enRaw = await rootBundle.loadString(assetForCode('EN'));
      fallback = jsonDecode(enRaw) as Map<String, dynamic>;
    }
    return AppLocalizations._(upper, data, fallback);
  }

  dynamic _resolve(Map<String, dynamic> source, List<String> parts) {
    dynamic node = source;
    for (final part in parts) {
      if (node is! Map<String, dynamic>) return null;
      node = node[part];
      if (node == null) return null;
    }
    return node;
  }

  /// Resolve a dot-separated path, e.g. `auth.phone` or `mobile.profile.language`.
  String t(String path, [Map<String, String> params = const {}]) {
    final parts = path.split('.');
    final node = _resolve(_data, parts) ?? _resolve(_fallback, parts);
    if (node == null) return path;
    var value = node.toString();
    params.forEach((key, replacement) {
      value = value.replaceAll('{$key}', replacement);
    });
    return value;
  }

  String get brand => t('brand');
  String get tagline => t('tagline');

  // Nav
  String get navHome => t('nav.home');
  String get navCourses => t('nav.courses');
  String get navStore => t('nav.store');
  String get navReels => t('nav.reels');
  String get navProfile => t('nav.profile');
  String get navNotifications => t('nav.notifications');
  String get navLogout => t('nav.logout');
  String get navLogin => t('nav.login');
  String get navSubscriptions => t('nav.subscriptions');
  String get navRankings => t('nav.rankings');

  // Common
  String get loading => t('common.loading');
  String get save => t('common.save');
  String get cancel => t('common.cancel');
  String get retry => t('mobile.error.retry');
  String get free => t('common.free');
  String get subscribe => t('common.subscribe');
  String get continueWatching => t('common.continue');

  // Auth
  String get authPhone => t('auth.phone');
  String get authPhonePlaceholder => t('auth.phonePlaceholder');
  String get authSendOtp => t('auth.sendOtp');
  String get authSending => t('auth.sending');
  String get authVerify => t('auth.verify');
  String get authVerifying => t('auth.verifying');
  String get authResend => t('auth.resend');
  String get authChangeNumber => t('auth.changeNumber');
  String get authRegister => t('auth.register');
  String get authStudent => t('auth.student');
  String get authCertificate => t('auth.certificate');
  String get authFullName => t('auth.fullName');
  String get authGender => t('auth.gender');
  String get authMale => t('auth.male');
  String get authFemale => t('auth.female');
  String get authCountry => t('auth.country');
  String get authProvince => t('auth.province');
  String get authEmail => t('auth.email');
  String get authNationalId => t('auth.nationalId');
  String get authNationalIdImage => t('auth.nationalIdImage');
  String get authParentPhone => t('auth.parentPhone');
  String get authStage => t('auth.stage');
  String get authGrade => t('auth.grade');
  String get authSchool => t('auth.school');
  String get authQualification => t('auth.qualification');
  String get authSpecialization => t('auth.specialization');
  String get authOccupation => t('auth.occupation');
  String get authSubmit => t('auth.submit');
  String get authPendingTitle => t('auth.pendingTitle');
  String get authPendingMessage => t('auth.pendingMessage');

  // Mobile login
  String get loginWelcome => t('mobile.login.welcome');
  String get loginSignInHint => t('mobile.login.signInHint');
  String get loginValidPhone => t('mobile.login.validPhone');
  String get loginSendCodeWhatsApp => t('mobile.login.sendCodeWhatsApp');
  String get loginEnterCode => t('mobile.login.enterCode');
  String get loginCodeSentPrefix => t('mobile.login.codeSentPrefix');
  String get loginCodeSentSuffix => t('mobile.login.codeSentSuffix');
  String get loginVerifyContinue => t('mobile.login.verifyContinue');
  String loginResendIn(int seconds) => t('mobile.login.resendIn', {'seconds': '$seconds'});
  String get learnWithoutLimits => t('mobile.learnWithoutLimits');

  // Home
  String get homeMyCourses => t('mobile.home.myCourses');
  String get homeReels => t('mobile.home.reels');
  String get homeAllStages => t('mobile.home.allStages');
  String get homeMyStage => t('mobile.home.myStage');
  String get homeStage => t('mobile.home.stage');
  String get homeNoCoursesInStage => t('mobile.home.noCoursesInStage');
  String get homeBrowseStore => t('mobile.home.browseStore');
  String homeSubscribers(int count) => t('mobile.home.subscribers', {'count': '$count'});
  String homeViews(int count) => t('mobile.home.views', {'count': '$count'});
  String homeLikes(int count) => t('mobile.home.likes', {'count': '$count'});
  String homeSaves(int count) => t('mobile.home.saves', {'count': '$count'});
  String homeLessons(int count) => t('mobile.home.lessons', {'count': '$count'});
  String homeDuration(int min) => t('mobile.home.duration', {'min': '$min'});
  String get homeAwaitingPayment => t('mobile.home.awaitingPayment');

  // Profile
  String get profileTapChangePhoto => t('mobile.profile.tapChangePhoto');
  String get profileChangePhoto => t('mobile.profile.changePhoto');
  String get profileAddPhoto => t('mobile.profile.addPhoto');
  String get profileRemovePhoto => t('mobile.profile.removePhoto');
  String get profilePhotoRemoved => t('mobile.profile.photoRemoved');
  String get profilePhotoRemoveFailed => t('mobile.profile.photoRemoveFailed');
  String get profilePhotoUpdated => t('mobile.profile.photoUpdated');
  String get profilePhotoUpdateFailed => t('mobile.profile.photoUpdateFailed');
  String get profileCoverTitle => t('mobile.profile.coverTitle');
  String get profileCoverHint => t('mobile.profile.coverHint');
  String get profileChangeCover => t('mobile.profile.changeCover');
  String get profileCoverUpdated => t('mobile.profile.coverUpdated');
  String get profileCoverSaveFailed => t('mobile.profile.coverSaveFailed');
  String get profileRole => t('mobile.profile.role');
  String get profileStatus => t('mobile.profile.status');
  String get profileLanguage => t('mobile.profile.language');
  String get profileStage => t('mobile.profile.stage');
  String get profileNotSet => t('mobile.profile.notSet');
  String get profileMyReports => t('mobile.profile.myReports');
  String get profileMyReportsHint => t('mobile.profile.myReportsHint');
  String get profileRankingsHint => t('mobile.profile.rankingsHint');
  String get profileFavorites => t('mobile.profile.favorites');
  String get profileFavoritesHint => t('mobile.profile.favoritesHint');
  String get profileSavedReels => t('mobile.profile.savedReels');
  String get profileSavedReelsHint => t('mobile.profile.savedReelsHint');
  String get profileCompletedCourses => t('mobile.profile.completedCourses');
  String get profileCompletedCoursesHint => t('mobile.profile.completedCoursesHint');
  String get profileCompletedSummary => t('mobile.profile.completedSummary');
  String get profileNoCompletedCourses => t('mobile.profile.noCompletedCourses');
  String get profileQuizNotTaken => t('mobile.profile.quizNotTaken');
  String profileCompletedCount(int count) =>
      t('mobile.profile.completedCount', {'count': '$count'});
  String profileTotalWatchTime(String duration) =>
      t('mobile.profile.totalWatchTime', {'duration': duration});
  String profileQuizResults(int passed, int taken) =>
      t('mobile.profile.quizResults', {'passed': '$passed', 'taken': '$taken'});
  String profileCompletedOn(String date) =>
      t('mobile.profile.completedOn', {'date': date});
  String get profileSubscriptionsHint => t('mobile.profile.subscriptionsHint');
  String get profileChangeStage => t('mobile.profile.changeStage');
  String get profileChangeStageHint => t('mobile.profile.changeStageHint');
  String get profileTeacherStudio => t('mobile.profile.teacherStudio');
  String get profileTeacherStudioHint => t('mobile.profile.teacherStudioHint');
  String get profileLogoutConfirm => t('mobile.profile.logoutConfirm');
  String get profileLanguageTitle => t('mobile.profile.languageTitle');
  String get profileLanguageSaved => t('mobile.profile.languageSaved');
  String get profileAppearance => t('mobile.profile.appearance');
  String get profileAppearanceTitle => t('mobile.profile.appearanceTitle');
  String get profileAppearanceHint => t('mobile.profile.appearanceHint');
  String get profileThemeSystem => t('mobile.profile.themeSystem');
  String get profileThemeSystemHint => t('mobile.profile.themeSystemHint');
  String get profileThemeLight => t('mobile.profile.themeLight');
  String get profileThemeLightHint => t('mobile.profile.themeLightHint');
  String get profileThemeDark => t('mobile.profile.themeDark');
  String get profileThemeDarkHint => t('mobile.profile.themeDarkHint');
  String get profileStorageCache => t('mobile.profile.storageCache');
  String profileStorageCacheHint(String size) =>
      t('mobile.profile.storageCacheHint', {'size': size});
  String get profileStorageCacheClear => t('mobile.profile.storageCacheClear');
  String get profileStorageCacheClearConfirm =>
      t('mobile.profile.storageCacheClearConfirm');
  String get profileStorageCacheCleared => t('mobile.profile.storageCacheCleared');

  String roleLabel(String role) => switch (role) {
        'STUDENT' => t('mobile.roles.student'),
        'CERTIFICATE_USER' => t('mobile.roles.certificateUser'),
        'TEACHER' => t('mobile.roles.teacher'),
        _ => role,
      };

  String languageName(String code) => t('mobile.language.${code.toUpperCase()}');

  // Student / store (web keys)
  String get studentWelcome => t('student.welcome');
  String get studentNoCourses => t('student.noCourses');
  String get studentNoCoursesHint => t('student.noCoursesHint');
  String get studentStoreTitle => t('student.storeTitle');
  String get studentStoreEmpty => t('student.storeEmpty');
  String get studentBuyCourse => t('student.buyCourse');
  String get studentPurchased => t('student.purchased');
  String get studentPurchasePending => t('student.purchasePending');
  String get studentEnrolled => t('student.enrolled');
  String get studentMin => t('student.min');
  String get studentMarkAllRead => t('student.markAllRead');
  String get studentNoNotifications => t('student.noNotifications');
  String get studentActivateCode => t('student.activateCode');
  String get studentRequestActivation => t('student.requestActivation');
  String get studentRequestSubmitted => t('student.requestSubmitted');
  String get studentActivated => t('student.activated');

  // Quiz
  String get quizStart => t('quiz.startQuiz');
  String get quizPrevious => t('quiz.previous');
  String get quizNext => t('quiz.next');
  String get quizSubmit => t('quiz.submit');
  String get quizSubmitting => t('quiz.submitting');
  String get quizPassed => t('quiz.passed');
  String get quizFailed => t('quiz.failed');
  String get quizTryAgain => t('quiz.tryAgain');
  String get quizDone => t('mobile.quiz.done');
  String get quizLoading => t('mobile.quiz.loading');
  String get quizTrue => t('quiz.trueLabel');
  String get quizFalse => t('quiz.falseLabel');

  // Rank
  String get rankTitle => t('rank.title');
  String get rankNoRankings => t('rank.noRankings');

  // Reels
  String get reelsTitle => t('mobile.reels.title');
  String get reelsRefresh => t('mobile.reels.refresh');
  String get reelsNoReels => t('mobile.reels.noReels');
  String get reelsDeleteTitle => t('mobile.reels.deleteTitle');
  String get reelsDeleteBody => t('mobile.reels.deleteBody');
  String get reelsDelete => t('mobile.reels.delete');
  String get reelsDeleted => t('mobile.reels.deleted');
  String get reelsDeleteFailed => t('mobile.reels.deleteFailed');
  String get reelsDeleteReel => t('mobile.reels.deleteReel');
  String get reelsReportContent => t('mobile.reels.reportContent');
  String get reelsViewTeacher => t('mobile.reels.viewTeacher');
  String get reelsSaveReel => t('mobile.reels.saveReel');
  String get reelsUnsaveReel => t('mobile.reels.unsaveReel');
  String get reelsSaved => t('mobile.reels.saved');
  String get reelsUnsaved => t('mobile.reels.unsaved');
  String get reelsFirstComment => t('mobile.reels.firstComment');
  String get reelsComments => t('mobile.reels.comments');
  String get reelsAddComment => t('mobile.reels.addComment');
  String get reelsReport => t('mobile.reels.report');
  String get reelsTeacherNotFound => t('mobile.reels.teacherNotFound');
  String get reelsSubscribedWatch => t('mobile.reels.subscribedWatch');
  String get reelsYourCourseOpen => t('mobile.reels.yourCourseOpen');
  String get reelsMore => t('mobile.reels.more');

  // Store mobile
  String get storeManageInStudio => t('mobile.store.manageInStudio');
  String get storeSubscribeUnlock => t('mobile.store.subscribeUnlock');
  String get storeVideoCompleted => t('mobile.store.videoCompleted');
  String storeReadyForQuiz(String title) => t('mobile.store.readyForQuiz', {'title': title});
  String get storeLater => t('mobile.store.later');
  String get storeGoToQuiz => t('mobile.store.goToQuiz');
  String storeUpNext(String title) => t('mobile.store.upNext', {'title': title});
  String get storePurchased => t('mobile.store.purchased');
  String get storeYourCourse => t('mobile.store.yourCourse');
  String get storePurchaseRequested => t('mobile.store.purchaseRequested');
  String get storePurchasePending => t('mobile.store.purchasePending');
  String get storeSubscriptionRequested => t('mobile.store.subscriptionRequested');
  String get storeLessonsTab => t('mobile.store.lessonsTab');
  String get storeQuizzesTab => t('mobile.store.quizzesTab');
  String get storeQaTab => t('mobile.store.qaTab');
  String get storeAbout => t('mobile.store.about');
  String get storeBuy => t('mobile.store.buy');
  String get storeNoDescription => t('mobile.store.noDescription');
  String get storeLessonLocked => t('mobile.store.lessonLocked');
  String storeDurationLikesSaves(String duration, int likes, int saves) =>
      t('mobile.store.durationLikesSaves', {
        'duration': duration,
        'likes': '$likes',
        'saves': '$saves',
      });

  // Cast
  String get castTitle => t('mobile.cast.title');
  String get castChooseChromecast => t('mobile.cast.chooseChromecast');

  // Studio
  String get studioPickVideoFirst => t('mobile.studio.pickVideoFirst');
  String get studioVideoUploaded => t('mobile.studio.videoUploaded');
  String get studioShortSubmitted => t('mobile.studio.shortSubmitted');
  String get studioVideoFile => t('mobile.studio.videoFile');
  String get studioCoverOptional => t('mobile.studio.coverOptional');
  String get studioChooseCover => t('mobile.studio.chooseCover');
  String get studioFromVideo => t('mobile.studio.fromVideo');
  String get studioYourShorts => t('mobile.studio.yourShorts');
  String get studioAddQuizMinOptions => t('mobile.studio.addQuizMinOptions');
  String get studioQuizAdded => t('mobile.studio.quizAdded');
  String studioQuizSaveFailed(String error) => t('mobile.studio.quizSaveFailed', {'error': error});
  String get studioAtEndOfCourse => t('mobile.studio.atEndOfCourse');
  String get studioCorrectAnswer => t('mobile.studio.correctAnswer');

  // QA
  String get qaPostFailed => t('mobile.qa.postFailed');
  String get qaAnswerFailed => t('mobile.qa.answerFailed');
  String get qaReply => t('mobile.qa.reply');

  // Report
  String get reportSubmitted => t('mobile.report.submitted');
  String get reportNoReports => t('mobile.report.noReports');
  String get reportNoReportsHint => t('mobile.report.noReportsHint');

  // Stage request
  String get stageRequestTitle => t('mobile.stageRequest.title');
  String get stageRequestSent => t('mobile.stageRequest.sent');
  String get stageRequestCurrentStage => t('mobile.stageRequest.currentStage');
  String get stageRequestRequestedStage => t('mobile.stageRequest.requestedStage');
  String get stageRequestCertificatePhoto => t('mobile.stageRequest.certificatePhoto');
  String get stageRequestSubmit => t('mobile.stageRequest.submit');

  // Register mobile
  String registerPhoneLabel(String phone) => t('mobile.register.phoneLabel', {'phone': phone});
  String registerIdUploadFailed(String error) => t('mobile.register.idUploadFailed', {'error': error});
  String get registerIdPhoto => t('mobile.register.idPhoto');
  String get registerIdUploaded => t('mobile.register.idUploaded');
  String get registerPickId => t('mobile.register.pickId');

  // Favorites
  String get favoritesCoursesTab => t('mobile.favorites.coursesTab');
  String get favoritesVideosTab => t('mobile.favorites.videosTab');
  String get favoritesEmptyCourses => t('mobile.favorites.emptyCourses');
  String get favoritesEmptyVideos => t('mobile.favorites.emptyVideos');

  // Pending
  String get pendingBadge => t('mobile.pending.badge');

  // Notifications mobile
  String get notificationsMarkAllRead => t('mobile.notifications.markAllRead');
}
