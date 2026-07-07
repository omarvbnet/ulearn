import 'package:flutter_test/flutter_test.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:flutter/material.dart';

void main() {
  testWidgets('StaggeredItem renders its child', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: StaggeredItem(index: 0, child: Text('hello')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('hello'), findsOneWidget);
  });
}
